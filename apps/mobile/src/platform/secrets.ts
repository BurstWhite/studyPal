/** API keys and the ZJU password, kept in the iOS keychain. */
import type { SecretStore } from "@studypal/core/platform";
import * as SecureStore from "expo-secure-store";

const options: SecureStore.SecureStoreOptions = {
  keychainService: "studyPal",
  // Readable by background refresh after the first unlock since boot.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const secretStore: SecretStore = {
  get: (name) => SecureStore.getItemAsync(name, options),
  set: (name, value) => SecureStore.setItemAsync(name, value, options),
  delete: (name) => SecureStore.deleteItemAsync(name, options),
};
