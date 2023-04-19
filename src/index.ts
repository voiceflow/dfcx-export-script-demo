import fs from 'node:fs/promises';
import path from 'node:path';

import type { protos } from '@google-cloud/dialogflow-cx';
import { EntityTypesClient, IntentsClient } from '@google-cloud/dialogflow-cx';
import { VF_ENTITY_REGEXP } from '@voiceflow/common';
import type { VoiceflowModels } from '@voiceflow/voiceflow-types';

const PROJECT_NAME = process.env.PROJECT_NAME!;
const KEYFILE = process.env.KEYFILE!;
const API_ENDPOINT = 'us-central1-dialogflow.googleapis.com';
const TAG = 'vf';
const INTENT_ID_LABEL = 'vf_intent_id';
const TAGGED_NAME_PATTERN = new RegExp(`^(.*)__([^-]*)-${TAG}$`);

const buildTaggedName = (name: string, id: string) => `${name}__${id}-${TAG}`;

const parseTaggedName = (fullName: string) => {
  const match = fullName.match(TAGGED_NAME_PATTERN);
  if (!match) return null;

  const [, name, id] = match;
  return { name, id };
};

const extractEntities = (utterance: string) => {
  const pattern = new RegExp(VF_ENTITY_REGEXP);
  const entities: Array<{ index: number; raw: string; name: string; id: string }> = [];

  let match: RegExpExecArray | null = null;

  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(utterance))) {
    const [raw, name, id] = match;
    entities.unshift({ index: match.index, raw, name, id });
  }

  return entities;
};

async function main() {
  // get first parameter from command line
  const [, , ...args] = process.argv;

  const readFilePath = args[0] || 'project.vf';
  const { name: readFileName } = path.parse(readFilePath);

  console.log(`Reading ${readFileName}`);

  const content = JSON.parse(await fs.readFile(readFilePath, 'utf8')) as VoiceflowModels.VF;

  const intentClient = new IntentsClient({ keyFilename: KEYFILE, apiEndpoint: API_ENDPOINT });
  const entityClient = new EntityTypesClient({ keyFilename: KEYFILE, apiEndpoint: API_ENDPOINT });

  const [remoteIntents] = await intentClient.listIntents({ parent: PROJECT_NAME });
  const existingIntents = new Set(remoteIntents.flatMap((intent) => intent.labels?.[INTENT_ID_LABEL] ?? []));

  const localEntities = Object.fromEntries(content.version.platformData.slots.map((entity) => [entity.key, entity]));
  const [remoteEntities] = await entityClient.listEntityTypes({ parent: PROJECT_NAME });
  const remoteEntityIDs: Record<string, string> = Object.fromEntries(
    remoteEntities.flatMap((entity) => {
      const parsed = parseTaggedName(entity.displayName ?? '');
      if (!parsed) return [];

      return [[parsed.id, entity.name!]];
    })
  );
  const existingEntities = new Set(Object.keys(remoteEntityIDs));

  await Promise.all(
    content.version.platformData.slots.map(async (entity) => {
      if (existingEntities.has(entity.key)) {
        console.log(`skipping entity '${entity.name}' that already exists in project, implement merging logic here`);
        return Promise.resolve();
      }

      console.log('uploading entity', entity.name);

      const [created] = await entityClient.createEntityType({
        parent: PROJECT_NAME,
        entityType: {
          displayName: buildTaggedName(entity.name, entity.key),
          kind: 'KIND_MAP',
          entities: entity.inputs.map((input) => ({
            value: input.split(',')[0],
            synonyms: input.split(','),
          })),
        },
      });

      remoteEntityIDs[entity.key] = created.name!;
    })
  );

  await Promise.all(
    content.version.platformData.intents.map((intent) => {
      if (intent.name.startsWith('VF.')) return Promise.resolve();

      if (existingIntents.has(intent.key)) {
        console.log(`skipping intent '${intent.name}' that already exists in project, implement merging logic here`);

        return Promise.resolve();
      }

      console.log('uploading intent', intent.name);

      const parameterIDs = Object.fromEntries(intent.slots?.map((entity) => [entity.id, localEntities[entity.id].name]) ?? []);
      const parameters: protos.google.cloud.dialogflow.cx.v3.Intent.IParameter[] =
        intent.slots?.map((entity) => ({
          id: parameterIDs[entity.id],
          entityType: remoteEntityIDs[entity.id],
        })) ?? [];

      return intentClient.createIntent({
        parent: PROJECT_NAME,
        intent: {
          displayName: intent.name,
          labels: { [INTENT_ID_LABEL]: intent.key },
          parameters,
          trainingPhrases: intent.inputs.map((utterance) => {
            if (!utterance.slots?.length) {
              return {
                id: null,
                parts: [{ text: utterance.text }],
                repeatCount: 1,
              };
            }

            const entities = extractEntities(utterance.text);
            const parts: protos.google.cloud.dialogflow.cx.v3.Intent.TrainingPhrase.IPart[] = [];

            let remaining = utterance.text;
            while (entities.length) {
              const entity = entities.pop()!;
              const slice = remaining.slice(entity.index + entity.raw.length);

              parts.unshift(
                { parameterId: parameterIDs[entity.id], text: localEntities[entity.id].inputs[0].split(',')[0] },
                ...(slice.trim() ? [{ text: slice }] : [])
              );

              remaining = remaining.slice(0, entity.index);
            }

            parts.unshift({ text: remaining });

            return {
              id: null,
              parts,
              repeatCount: 1,
            };
          }),
        },
      });
    })
  );
}

main();
