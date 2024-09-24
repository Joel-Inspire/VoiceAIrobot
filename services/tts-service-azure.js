require('dotenv').config();
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { EventEmitter } = require('events');
const { Buffer } = require('node:buffer');

class TextToSpeechService extends EventEmitter {
  constructor() {
    super();
    const speechKey = process.env.AZURE_SPEECH_KEY;
    const serviceRegion = process.env.AZURE_SPEECH_REGION;

    if (!speechKey || !serviceRegion) {
      throw new Error('Azure Speech key and region must be set in environment variables.');
    }

    // Creates an instance of a speech config with specified subscription key and service region.
    this.speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, serviceRegion);
    this.speechConfig.speechSynthesisLanguage = 'lv-LV'; // Latvian language
    this.speechConfig.speechSynthesisVoiceName = 'lv-LV-NilsNeural'; // Nils voice

    // Set the output format to Raw 8kHz 8-bit Mono mu-law
    this.speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Raw8Khz8BitMonoMULaw;

    this.nextExpectedIndex = 0;
    this.speechBuffer = {};
  }

  generate(gptReply, interactionCount) {
    const { partialResponseIndex, partialResponse } = gptReply;

    if (!partialResponse) { return; }

    try {
      // Creates a speech synthesizer using the configured speech config
      const audioConfig = null; // Since we are getting the audio data as a buffer
      const synthesizer = new sdk.SpeechSynthesizer(this.speechConfig, audioConfig);

      synthesizer.speakTextAsync(
        partialResponse,
        (result) => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            const audioBuffer = result.audioData;

            // Directly convert audio data to base64 string
            const base64String = Buffer.from(audioBuffer).toString('base64');

            // Emit the speech event with the base64 audio data
            this.emit('speech', partialResponseIndex, base64String, partialResponse, interactionCount);
          } else {
            console.error('Speech synthesis canceled: ' + result.errorDetails);
          }
          synthesizer.close();
        },
        (error) => {
          console.error('Error synthesizing speech:', error);
          synthesizer.close();
        }
      );
    } catch (err) {
      console.error('Error occurred in TextToSpeech service:', err);
    }
  }
}

module.exports = { TextToSpeechService };
