require('dotenv').config();
require('colors');

const express = require('express');
const ExpressWs = require('express-ws');

const { GptService } = require('./services/gpt-service');
const { StreamService } = require('./services/stream-service');
const { TranscriptionService } = require('./services/transcription-service');
const { TextToSpeechService } = require('./services/tts-service');
const { recordingService } = require('./services/recording-service');

const VoiceResponse = require('twilio').twiml.VoiceResponse;

const app = express();
ExpressWs(app);

const PORT = process.env.PORT || 3000;

async function getCallerNumber(call) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = require('twilio')(accountSid, authToken);

  const response = await client.calls(call.callSid).fetch();
  return response.from;
}

app.post('/incoming', (req, res) => {
  try {
    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: `wss://${process.env.SERVER}/connection` });

    res.type('text/xml');
    res.end(response.toString());
  } catch (err) {
    console.log(err);
  }
});

const activeCalls = {};

function bindCall(call) {
  const { streamSid, gptService, streamService, transcriptionService, ttsService, marks, ws } = call;

  let interactionCount = 0;

  transcriptionService.on('utterance', async (text) => {
    // This is a bit of a hack to filter out empty utterances
    if(marks.length > 0 && text?.length > 5) {
      console.log('Twilio -> Interruption, Clearing stream'.red);
      ws.send(
        JSON.stringify({
          streamSid,
          event: 'clear',
        })
      );
    }
  });

  transcriptionService.on('transcription', async (text) => {
    if (!text) { return; }
    console.log(`Interaction ${interactionCount} – STT -> GPT: ${text}`.yellow);
    gptService.completion(text, interactionCount);
    interactionCount += 1;
  });

  gptService.on('gptreply', async (gptReply, icount) => {
    console.log(`Interaction ${icount}: GPT -> TTS: ${gptReply.partialResponse}`.green );
    ttsService.generate(gptReply, icount);
  });

  ttsService.on('speech', (responseIndex, audio, label, icount) => {
    console.log(`Interaction ${icount}: TTS -> TWILIO: ${label}`.blue);

    streamService.buffer(responseIndex, audio);
  });

  streamService.on('audiosent', (markLabel) => {
    marks.push(markLabel);
  });
}

app.ws('/connection', (ws) => {
  try {
    ws.on('error', console.error);
    // Filled in from start message
    let streamSid;
    let callSid;

    let call = null;

    // Incoming from MediaStream
    ws.on('message', function message(data) {
      const msg = JSON.parse(data);
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;

        getCallerNumber(msg.start).then((number) => {
          if (activeCalls[number]) {
            return;
          }
          console.log(`Twilio -> received new call from ${number}`);

          const transcriptionService = new TranscriptionService();

          call = {
            callSid: callSid,
            streamSid: streamSid,
            gptService: new GptService(),
            streamService: new StreamService(ws),
            transcriptionService: transcriptionService,
            ttsService: new TextToSpeechService({}),
            marks: [],
            ws: ws
          };
          activeCalls[number] = call;
          bindCall(call);

          call.streamService.setStreamSid(streamSid);
          call.gptService.setCallSid(callSid);

          // Set RECORDING_ENABLED='true' in .env to record calls
          recordingService(call.ttsService, callSid).then(() => {
            console.log(`Twilio -> Starting Media Stream for ${streamSid}`.underline.red);
            call.ttsService.generate({partialResponseIndex: null, partialResponse: 'Hello! I understand you\'re looking for a pair of AirPods, is that correct?'}, 0);
          });
        });
      } else if (msg.event === 'media') {
        if (call && call.transcriptionService != null) {
          call.transcriptionService.send(msg.media.payload);
        }
      } else if (msg.event === 'mark') {
        const label = msg.mark.name;
        console.log(`Twilio -> Audio completed mark (${msg.sequenceNumber}): ${label}`.red);
        if (call && call.marks) {
          call.marks = call.marks.filter(m => m !== msg.mark.name);
        }
      } else if (msg.event === 'stop') {
        console.log(`Twilio -> Media stream ${streamSid} ended.`.underline.red);

        for (const k in Object.keys(activeCalls)) {
          if (activeCalls[k] && activeCalls[k].callSid == callSid) {
            delete activeCalls[k];
            return;
          }
        }
      }
    });
  } catch (err) {
    console.log(err);
  }
});

app.listen(PORT);
console.log(`Server running on port ${PORT}`);
