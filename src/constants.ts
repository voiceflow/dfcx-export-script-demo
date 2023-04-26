export const PROJECT_NAME = process.env.PROJECT_NAME!;
export const KEYFILE = process.env.KEYFILE!;
export const API_ENDPOINT = 'us-central1-dialogflow.googleapis.com';
export const TAG = 'vf';
export const INTENT_ID_LABEL = 'vf_intent_id';
export const TAGGED_NAME_PATTERN = new RegExp(`^(.*)__([^-]*)-${TAG}$`);
