const OpenAI = require("openai"); // or the appropriate module import
const EventEmitter = require("events");
const availableFunctions = require("../functions/available-functions");
const tools = require("../functions/function-manifest");
let prompt = require("../prompts/prompt");
//const welcomePrompt = require("../prompts/welcomePrompt");
const model = "gpt-4o";

const currentDate = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

prompt = prompt.replace("{{currentDate}}", currentDate);

class GptService extends EventEmitter {
  constructor() {
    super();
    this.openai = new OpenAI();
    this.userContext = [
      { role: "system", content: prompt },
      // //Only do this if you're going to use the WelcomePrompt in VoxRay config
      // {
      //   role: "assistant",
      //   content: `${welcomePrompt}`,
      // },
    ];
    this.smsSendNumber = null; // Store the "To" number (Twilio's "from")
    this.phoneNumber = null; // Store the "From" number (user's phone)
  }
  // Arrow function for getTtsMessageForTool, so it can access `this`
  getTtsMessageForTool = (toolName) => {
    const name = this.userProfile?.profile?.firstName
      ? this.userProfile.profile.firstName
      : ""; // Get the user's name if available

    const nameIntroOptions = name
      ? [
          `Sure ${name},`,
          `Okay ${name},`,
          `Alright ${name},`,
          `Got it ${name},`,
          `Certainly ${name},`,
        ]
      : ["Sure,", "Okay,", "Alright,", "Got it,", "Certainly,"];

    const randomIntro =
      nameIntroOptions[Math.floor(Math.random() * nameIntroOptions.length)];

    let message;

    switch (toolName) {
      case "listAvailableApartments":
        message = `${randomIntro} let me check on the available apartments for you.`;
        break;
      case "checkExistingAppointments":
        message = `${randomIntro} I'll look up your existing appointments.`;
        break;
      case "scheduleTour":
        message = `${randomIntro} I'll go ahead and schedule that tour for you.`;
        break;
      case "checkAvailability":
        message = `${randomIntro} let me verify the availability for the requested time.`;
        break;
      case "commonInquiries":
        message = `${randomIntro} one moment.`;
        break;
      case "sendAppointmentConfirmationSms":
        message = `${randomIntro} I'll send that SMS off to you shortly, give it a few minutes and you should see it come through.`;
        break;
      case "liveAgentHandoff":
        message = `${randomIntro} that may be a challenging topic to discuss, so I'm going to get you over to a live agent so they can discuss this with you, hang tight.`;
        break;
      default:
        message = `${randomIntro} give me a moment while I fetch the information.`;
        break;
    }

    // Log the message to the userContext in gptService
    this.updateUserContext("assistant", message);

    return message; // Return the message for TTS
  };

  setUserProfile(userProfile) {
    this.userProfile = userProfile;
    if (userProfile) {
      const { firstName } = userProfile.profile;
      const historySummaries = userProfile.conversationHistory
        .map(
          (history) =>
            `On ${history.date}, ${firstName} asked: ${history.summary}`
        )
        .join(" ");
      // Add the conversation history to the system context
      this.userContext.push({
        role: "system",
        content: `${firstName} has had previous interactions. Conversation history: ${historySummaries}`,
      });
    }
  }

  // Method to store the phone numbers from app.js
  setPhoneNumbers(smsSendNumber, phoneNumber) {
    this.smsSendNumber = smsSendNumber;
    this.phoneNumber = phoneNumber;
  }

  // Method to retrieve the stored numbers (can be used in the function calls)
  getPhoneNumbers() {
    return { to: this.smsSendNumber, from: this.phoneNumber };
  }

  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  updateUserContext(role, text) {
    this.userContext.push({ role: role, content: text });
  }

  async summarizeConversation() {
    const summaryPrompt = "Summarize the conversation so far in 2-3 sentences.";

    // // Log the full userContext before making the API call
    // console.log(
    //   `[GptService] Full userContext: ${JSON.stringify(
    //     this.userContext,
    //     null,
    //     2
    //   )}`
    // );

    // // Validate and log each message in userContext
    // this.userContext.forEach((message, index) => {
    //   if (typeof message.content !== "string") {
    //     console.error(
    //       `[GptService] Invalid content type at index ${index}: ${JSON.stringify(
    //         message
    //       )}`
    //     );
    //   } else {
    //     console.log(
    //       `[GptService] Valid content at index ${index}: ${message.content}`
    //     );
    //   }
    // });

    const summaryResponse = await this.openai.chat.completions.create({
      model: model,
      messages: [
        ...this.userContext,
        { role: "system", content: summaryPrompt },
      ],
      stream: false, // Non-streaming
    });

    const summary = summaryResponse.choices[0]?.message?.content || "";
    return summary;
  }

  async completion(
    text,
    interactionCount,
    role = "user",
    dtmfTriggered = false
  ) {
    if (!text || typeof text !== "string") {
      this.log(`[GptService] Invalid prompt received: ${text}`);
      return;
    }

    this.updateUserContext(role, text);

    try {
      // Streaming is enabled
      const response = await this.openai.chat.completions.create({
        model: model,
        messages: this.userContext,
        tools: tools,
        stream: true, // Always streaming
      });

      let toolCalls = {}; // Object to accumulate multiple tool calls by their ID
      let functionCallResults = []; // Array to accumulate function call results
      let contentAccumulator = ""; // To accumulate the 'content' before tool_calls
      let finalMessageObject = {
        role: "assistant",
        content: null,
        tool_calls: [],
        refusal: null,
      }; // Final object to store content and tool call details

      let currentToolCallId = null; // To store the ID of the active tool call

      for await (const chunk of response) {
        const { choices } = chunk;

        //Log each chunk as it comes in
        // this.log(`[GptService] Chunk received: ${JSON.stringify(chunk)}`);

        // Check if tool_calls are present in this chunk (could be part of multiple chunks)
        if (choices[0]?.delta?.tool_calls) {
          const toolCall = choices[0].delta.tool_calls[0];

          // Check if this is a new tool call (only when an ID is present)
          if (toolCall.id && toolCall.id !== currentToolCallId) {
            // Check if currentToolCallId is not null, indicating a subsequent tool call
            const isFirstToolCall = currentToolCallId === null;

            currentToolCallId = toolCall.id;

            // Initialize new tool call if not already in the map
            if (!toolCalls[currentToolCallId]) {
              // this.log(
              //   `[GptService] Final Content of this tool call: ${contentAccumulator}`
              // );

              if (choices[0]?.delta?.content) {
                // this.log(
                //   `[GptService] Last chunk to emit: ${choices[0].delta.content}`
                // );
                this.emit(
                  "gptreply",
                  choices[0]?.delta?.content,
                  true,
                  interactionCount
                );
              } else {
                // this.log(
                //   `[GptService] Emitting empty string as final content chunk to voxray`
                // );
                //If the content is empty (in the case of OpenAI Chat Completions, it will ALWAYS be this) then just send an empty token
                this.emit("gptreply", "", true, interactionCount);
              }

              //Log the last content to an assistant message (IS THIS AN OPENAI BUG??? For some reason, the finish_reason never is "STOP" and we miss the final punctuation (eg. "One Moment" should be "One Moment." where the period is the final content, but that period is being sent back after the function call completes))
              if (contentAccumulator.length > 0 && isFirstToolCall) {
                this.userContext.push({
                  role: "assistant",
                  content: contentAccumulator.trim(),
                });

                // // Log the full userContext before making the API call
                // console.log(
                //   `[GptService] Full userContext before next tool call id: ${JSON.stringify(
                //     this.userContext,
                //     null,
                //     2
                //   )}`
                // );

                this.log(
                  `[GptService] Final GPT -> user context length: ${this.userContext.length}`
                );
              }

              toolCalls[currentToolCallId] = {
                id: currentToolCallId,
                functionName: toolCall.function.name,
                arguments: "", // Initialize an empty string for accumulating arguments
              };

              // Log tool call detection
              this.log(
                `[GptService] Detected new tool call: ${toolCall.function.name}`
              );
              // Log tool call detection
              // this.log(
              //   `[GptService] Log the choices: ${JSON.stringify(choices[0])}`
              // );
            }
          }
        }

        // Separate block to handle when finish_reason is 'tool_calls'
        if (choices[0]?.finish_reason === "tool_calls") {
          this.log(`[GptService] All tool calls have been completed`);
          const systemMessages = [];
          // Process each tool call in the accumulated toolCalls object
          for (const toolCallId in toolCalls) {
            const toolCall = toolCalls[toolCallId];
            let parsedArguments;
            try {
              // Parse accumulated arguments for this tool call
              parsedArguments = JSON.parse(toolCall.arguments);
            } catch (error) {
              console.error("Error parsing arguments:", error);
              parsedArguments = toolCall.arguments; // Fallback in case of parsing failure
            }

            // Finalize the tool call in the final message object
            finalMessageObject.tool_calls.push({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.functionName,
                arguments: JSON.stringify(parsedArguments), // Ensure arguments are stringified
              },
            });

            // if (!dtmfTriggered) {
            //   // Emit TTS message related to the tool call
            //   const ttsMessage = this.getTtsMessageForTool(toolCallFunctionName);
            //   this.emit("gptreply", ttsMessage, true, interactionCount); // Emit the TTS message immediately
            // }

            // Inject phone numbers if it's the SMS function
            if (toolCall.functionName === "sendAppointmentConfirmationSms") {
              const phoneNumbers = this.getPhoneNumbers();
              parsedArguments = { ...parsedArguments, ...phoneNumbers };
            }
            // Now perform the tool logic as all tool_call data is ready
            const functionToCall = availableFunctions[toolCall.functionName];

            this.log(
              `[GptService] Calling function ${
                toolCall.functionName
              } with arguments: ${JSON.stringify(parsedArguments)}`
            );

            // Call the respective function
            const functionResponse = await functionToCall(parsedArguments);

            // Construct the function call result message for this tool call
            functionCallResults.push({
              role: "tool",
              content: JSON.stringify(functionResponse),
              tool_call_id: toolCall.id,
            });

            // Check if specific tool calls require additional system messages

            if (toolCall.functionName === "listAvailableApartments") {
              systemMessages.push({
                role: "system",
                content:
                  "Provide a summary of available apartments. Do not you symbols, and do not use markdown in your response.",
              });
            }

            // Personalize system messages based on user profile during relevant tool calls
            if (
              toolCall.functionName === "checkAvailability" &&
              this.userProfile
            ) {
              const { firstName, moveInDate } = this.userProfile.profile;
              systemMessages.push({
                role: "system",
                content: `When checking availability for ${firstName}, remember that they are looking to move in on ${moveInDate}.`,
              });
            }

            if (
              toolCall.functionName === "scheduleTour" &&
              functionResponse.available
            ) {
              // Inject a system message to ask about SMS confirmation
              systemMessages.push({
                role: "system",
                content:
                  "If the user agrees to receive an SMS confirmation, immediately trigger the 'sendAppointmentConfirmationSms' tool with the appointment details and the UserProfile. Do not ask for their phone number or any other details from the user.",
              });
            }

            // Check if the tool call is for the 'liveAgentHandoff' function
            if (toolCall.functionName === "liveAgentHandoff") {
              setTimeout(async () => {
                const conversationSummary = await this.summarizeConversation();

                this.emit("endSession", {
                  reasonCode: "live-agent-handoff",
                  reason: functionResponse.reason,
                  conversationSummary: conversationSummary,
                });

                this.log(
                  `[GptService] Emitting endSession event with reason: ${functionResponse.reason}`
                );
              }, 3000); // 3-second delay

              this.log(
                `[GptService] Emitting endSession event with reason: ${functionResponse.reason}`
              );
            }
          }

          // Prepare the chat completion call payload with the tool result
          const completion_payload = {
            model: model,
            messages: [
              ...this.userContext,
              ...systemMessages, // Inject dynamic system messages when relevant
              finalMessageObject, // the tool_call message
              ...functionCallResults, // The result of the tool call
            ],
          };

          // //Log the payload to the console
          // console.log(
          //   `[GptService] Completion payload: ${JSON.stringify(
          //     completion_payload,
          //     null,
          //     2
          //   )}`
          // );

          // Call the API again with streaming for final response
          const finalResponseStream = await this.openai.chat.completions.create(
            {
              model: completion_payload.model,
              messages: completion_payload.messages,
              stream: true,
            }
          );

          // Handle the final response stream (same logic as before)
          let finalContentAccumulator = "";
          for await (const chunk of finalResponseStream) {
            const { choices } = chunk;

            // this.log(
            //   `[GptService] Final Chunk received: ${JSON.stringify(chunk)}`
            // );

            // Accumulate the content from each chunk
            if (!choices[0]?.delta?.tool_calls) {
              // Check if the current chunk is the last one in the stream
              if (choices[0].finish_reason === "stop") {
                this.log(`[GptService] In finish reason === STOP`);

                if (choices[0]?.delta?.content) {
                  // this.log(
                  //   `[GptService] Last chunk to emit (non-tool call): ${choices[0].delta.content}`
                  // );
                  this.emit(
                    "gptreply",
                    choices[0]?.delta?.content,
                    true,
                    interactionCount
                  );
                  //accumulate the final content chunk before pushing to user context
                  finalContentAccumulator += choices[0].delta.content;
                } else {
                  // this.log(
                  //   `[GptService] Emitting empty string as final content chunk (non-tool call) to voxray`
                  // );
                  //If the content is empty (in the case of OpenAI Chat Completions, it will ALWAYS be this) then just send an empty token
                  this.emit("gptreply", "", true, interactionCount);
                }
                // if (lastContentChunk) {
                //   this.emit("gptreply", lastContentChunk, true, interactionCount);
                // }

                this.userContext.push({
                  role: "assistant",
                  content: finalContentAccumulator.trim(),
                });

                // Log the full userContext before making the API call
                // console.log(
                //   `[GptService] Full userContext after tool call: ${JSON.stringify(
                //     this.userContext,
                //     null,
                //     2
                //   )}`
                // );

                this.log(
                  `[GptService] Final GPT -> user context length: ${this.userContext.length}`
                );

                break; // Exit the loop once the final response is complete
              } else {
                //We only will start emitting chunks after the chunk with ROLE defined "delta":{"role":"assistant","content":"","refusal":null} because there is no content here
                if (!choices[0]?.delta?.role && choices[0]?.delta?.content) {
                  // this.log(
                  //   `[GptService] Emitting intermediary chunk (tool call): ${choices[0].delta.content}`
                  // );
                  //emit the chunk knowing its a content chunk and not the final one
                  this.emit(
                    "gptreply",
                    choices[0].delta.content,
                    false,
                    interactionCount
                  );
                  //continue accumulating content chunks
                  finalContentAccumulator += choices[0].delta.content;
                }
              }
            }
          }
          // Reset tool call state after completion
          toolCalls = {}; // Clear all stored tool calls
          currentToolCallId = null; // Reset tool call ID
        } else {
          // If the Finish Reason isn't "tool_calls", then accumulate arguments for the current tool call
          if (currentToolCallId && toolCalls[currentToolCallId]) {
            if (choices[0]?.delta?.tool_calls[0]?.function?.arguments) {
              toolCalls[currentToolCallId].arguments +=
                choices[0].delta.tool_calls[0].function.arguments;
              // this.log(
              //   `[GptService] Accumulated arguments for tool call ${currentToolCallId}: ${toolCalls[currentToolCallId].arguments}`
              // );
            }
          }
        }

        // Handle non-tool_call content chunks
        if (!choices[0]?.delta?.tool_calls) {
          // Check if the current chunk is the last one in the stream
          if (choices[0].finish_reason === "stop") {
            this.log(`[GptService] In finish reason === STOP`);

            if (choices[0]?.delta?.content) {
              // this.log(
              //   `[GptService] Last chunk to emit (non-tool call): ${choices[0].delta.content}`
              // );
              this.emit(
                "gptreply",
                choices[0]?.delta?.content,
                true,
                interactionCount
              );
              //accumulate the final content chunk before pushing to user context
              contentAccumulator += choices[0].delta.content;
            } else {
              // this.log(
              //   `[GptService] Emitting empty string as final content chunk (non-tool call) to voxray`
              // );
              //If the content is empty (in the case of OpenAI Chat Completions, it will ALWAYS be this) then just send an empty token
              this.emit("gptreply", "", true, interactionCount);
            }
            // if (lastContentChunk) {
            //   this.emit("gptreply", lastContentChunk, true, interactionCount);
            // }

            this.userContext.push({
              role: "assistant",
              content: contentAccumulator.trim(),
            });

            // // Log the full userContext before making the API call
            // console.log(
            //   `[GptService] Full userContext after non tool call: ${JSON.stringify(
            //     this.userContext,
            //     null,
            //     2
            //   )}`
            // );

            this.log(
              `[GptService] Final GPT -> user context length: ${this.userContext.length}`
            );

            break; // Exit the loop once the final response is complete
          } else {
            //We only will start emitting chunks after the chunk with ROLE defined "delta":{"role":"assistant","content":"","refusal":null} because there is no content here, also need to make sure finish reason isn't a tool call
            if (!choices[0]?.delta?.role && choices[0]?.delta?.content) {
              //Log each chunk as it comes in
              // this.log(
              //   `[GptService] Emitting intermediary chunk (non tool call): ${choices[0].delta.content}`
              // );
              //emit the chunk knowing its a content chunk and not the final one
              this.emit(
                "gptreply",
                choices[0].delta.content,
                false,
                interactionCount
              );
              //continue accumulating content chunks
              contentAccumulator += choices[0].delta.content;
            }
          }
        }

        // if (choices[0]?.delta?.refusal !== null) {
        //   finalMessageObject.refusal = choices[0].delta.refusal;
        // }
      }
    } catch (error) {
      this.log(`[GptService] Error during completion: ${error.stack}`);

      // Friendly response for any error encountered
      const friendlyMessage =
        "I apologize, that request might have been a bit too complex. Could you try asking one thing at a time? I'd be happy to help step by step!";

      // Emit the friendly message to the user
      this.emit("gptreply", friendlyMessage, true, interactionCount);

      // Push the message into the assistant context
      this.updateUserContext("assistant", friendlyMessage);

      return; // Stop further processing
    }
  }
}
module.exports = { GptService };
