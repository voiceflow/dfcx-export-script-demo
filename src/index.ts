import fs from 'node:fs/promises';
import path from 'node:path';

import { IntentsClient } from '@google-cloud/dialogflow-cx';
import type { VoiceflowModels } from '@voiceflow/voiceflow-types';

const projectName = process.env.PROJECT_NAME!;

async function main() {
  // get first parameter from command line
  const [, , ...args] = process.argv;

  const readFilePath = args[0] || 'project.vf';
  const { name: readFileName } = path.parse(readFilePath);

  console.log(`Reading ${readFileName}`);

  const content = JSON.parse(await fs.readFile(readFilePath, 'utf8')) as VoiceflowModels.VF;

  const client = new IntentsClient({
    keyFilename: '/Users/benteichman/Downloads/df-demo-coffee-agent-yqsb-fec53be13bfa.json',
    apiEndpoint: 'us-central1-dialogflow.googleapis.com',
  });

  const [remoteIntents] = await client.listIntents({ parent: projectName });
  const existingIntents = new Set(remoteIntents.flatMap((intent) => intent.labels?.vf_intent ?? []));

  await Promise.all(
    content.version.platformData.intents.map((intent) => {
      if (intent.name.startsWith('VF.')) return Promise.resolve();

      if (existingIntents.has(intent.key)) {
        console.log('skipping intent', intent.name);

        return Promise.resolve();
      }

      console.log('uploading intent', intent.name);

      return client.createIntent({
        parent: projectName,
        intent: {
          // name: intent.name,
          displayName: intent.name,
          trainingPhrases: intent.inputs.map((utterance) => ({
            id: null,
            parts: utterance.slots?.length ? [] : [{ text: utterance.text }],
            repeatCount: 1,
          })),
          labels: { vf_intent: intent.key },
        },
      });
    })
  );
}

main();
