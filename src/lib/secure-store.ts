// BEGIN HANDOVER: SECURE_STORE
import * as SecureStore from "expo-secure-store";
export const secure = {
  get: (k:string)=>SecureStore.getItemAsync(k),
  set: (k:string,v:string)=>SecureStore.setItemAsync(k,v,{keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK}),
  del: (k:string)=>SecureStore.deleteItemAsync(k)
};
// END HANDOVER: SECURE_STORE
