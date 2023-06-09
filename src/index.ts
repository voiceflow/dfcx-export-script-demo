/* eslint-disable no-console */
import fs from 'node:fs/promises';
import path from 'node:path';

import type { protos } from '@google-cloud/dialogflow-cx';
import { EntityTypesClient, IntentsClient, PagesClient } from '@google-cloud/dialogflow-cx';
import type { Slot } from '@voiceflow/base-types/build/cjs/models';
import type { VoiceflowDiagram, VoiceflowModels } from '@voiceflow/voiceflow-types';

import { API_ENDPOINT, INTENT_ID_LABEL, KEYFILE, PROJECT_NAME } from './constants';
import { buildTaggedName, extractEntities, parseTaggedName } from './utils';

const HOME_DIAGRAM_ID = '642d959f32a4cc000749e866';
const FLOW_NAME = `${PROJECT_NAME}/flows/00000000-0000-0000-0000-000000000000`;

async function uploadEntities(
  content: VoiceflowModels.VF,
  existingEntities: Set<string>,
  remoteEntityIDs: Record<string, string>,
  entityClient: EntityTypesClient
) {
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

      // eslint-disable-next-line no-param-reassign
      remoteEntityIDs[entity.key] = created.name!;
    })
  );
}

async function uploadIntents(
  content: VoiceflowModels.VF,
  existingIntents: Set<string>,
  localEntities: Record<string, Slot>,
  remoteEntityIDs: Record<string, string>,
  intentClient: IntentsClient
) {
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

const uploadPages = async (subTopics: VoiceflowDiagram.Diagram[], existingPages: Set<string>, pageClient: PagesClient) =>
  Promise.all(
    subTopics.map((subTopic) => {
      if (existingPages.has(subTopic._id)) {
        console.log(`skipping sub-topic '${subTopic.name}' that already exists in project, implement merging logic here`);

        return Promise.resolve();
      }

      console.log('uploading sub-topic', subTopic.name);

      return pageClient.createPage({
        parent: FLOW_NAME,
        page: {
          displayName: buildTaggedName(subTopic.name, subTopic._id),
        },
      });
    })
  );

async function main() {
  // get first parameter from command line
  const [, , ...args] = process.argv;

  // reading .vf project file

  const readFilePath = args[0] || 'project.vf';
  const { name: readFileName } = path.parse(readFilePath);

  console.log(`Reading ${readFileName}`);

  const content = JSON.parse(await fs.readFile(readFilePath, 'utf8')) as VoiceflowModels.VF;

  const intentClient = new IntentsClient({ keyFilename: KEYFILE, apiEndpoint: API_ENDPOINT });
  const entityClient = new EntityTypesClient({ keyFilename: KEYFILE, apiEndpoint: API_ENDPOINT });
  const pageClient = new PagesClient({ keyFilename: KEYFILE, apiEndpoint: API_ENDPOINT });

  // extracting intents

  const [remoteIntents] = await intentClient.listIntents({ parent: PROJECT_NAME });
  const existingIntents = new Set(remoteIntents.flatMap((intent) => intent.labels?.[INTENT_ID_LABEL] ?? []));

  // extracting entities

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

  const [remotePages] = await pageClient.listPages({ parent: FLOW_NAME });

  // extracting sub-topics

  const subTopicsIDs =
    content.diagrams[HOME_DIAGRAM_ID].menuItems?.filter((menuItem) => menuItem.type === 'DIAGRAM').map((menuItem) => menuItem.sourceID) ?? [];
  const subTopics = subTopicsIDs.map((id) => content.diagrams[id]);

  const remotePageIDs: Record<string, string> = Object.fromEntries(
    remotePages.flatMap((page) => {
      const parsed = parseTaggedName(page.displayName ?? '');
      if (!parsed) return [];

      return [[parsed.id, page.name!]];
    })
  );
  const existingPages = new Set(Object.keys(remotePageIDs));

  // uploading to DFCX

  await uploadPages(subTopics, existingPages, pageClient);
  await uploadEntities(content, existingEntities, remoteEntityIDs, entityClient);
  await uploadIntents(content, existingIntents, localEntities, remoteEntityIDs, intentClient);
}

main();
