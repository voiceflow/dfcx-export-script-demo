import { VF_ENTITY_REGEXP } from '@voiceflow/common';

import { TAG, TAGGED_NAME_PATTERN } from './constants';

export const buildTaggedName = (name: string, id: string) => `${name}__${id}-${TAG}`;

export const parseTaggedName = (fullName: string) => {
  const match = fullName.match(TAGGED_NAME_PATTERN);
  if (!match) return null;

  const [, name, id] = match;
  return { name, id };
};

export const extractEntities = (utterance: string) => {
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
