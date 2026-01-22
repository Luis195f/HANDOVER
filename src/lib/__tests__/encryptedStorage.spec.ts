import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptedGetItem, encryptedRemoveItem, encryptedSetItem } from '@/src/lib/encryptedStorage';

describe('encryptedStorage', () => {
  const storageKey = 'handover:test:encrypted-storage';

  afterEach(async () => {
    await encryptedRemoveItem(storageKey);
  });

  it('stores encrypted values and decrypts back to the original payload', async () => {
    const payload = { patientName: 'Jane Doe', notes: 'Sensitive handover notes' };

    await encryptedSetItem(storageKey, payload);

    const raw = await AsyncStorage.getItem(storageKey);
    expect(raw).toBeTruthy();
    expect(JSON.stringify(raw)).not.toContain('Jane Doe');
    expect(JSON.stringify(raw)).not.toContain('Sensitive handover notes');

    const decrypted = await encryptedGetItem(storageKey);
    expect(decrypted).not.toBeNull();
    expect(JSON.parse(decrypted as string)).toEqual(payload);
  });
});
