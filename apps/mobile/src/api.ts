import { configureApiClient } from '@wayfare/api-client';
import * as Application from 'expo-application';
import { API_URL } from './env';
import { deviceSession } from './session';

/** The installed build's version, which the gateway checks against `MIN_SUPPORTED_APP_VERSION`. */
export const APP_VERSION = Application.nativeApplicationVersion ?? '0.0.0';

// Every generated hook goes through this one configuration (conventions §12.1).
configureApiClient({
  baseUrl: API_URL,
  client: 'mobile',
  appVersion: APP_VERSION,
  session: deviceSession,
});
