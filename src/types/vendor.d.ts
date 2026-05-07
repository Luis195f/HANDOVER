declare module '@expo/vector-icons' {
  import type { ComponentType } from 'react';
  export const MaterialIcons: ComponentType<any>;
  export const Ionicons: ComponentType<any>;
  export const MaterialCommunityIcons: ComponentType<any>;
}

declare module 'crypto-js' {
  namespace CryptoJS {
    interface Encoder {
      stringify(wordArray: lib.WordArray): string;
      parse(value: string): lib.WordArray;
    }

    namespace lib {
      interface WordArray {
        sigBytes: number;
        toString(encoder?: Encoder): string;
      }

      interface CipherParams {
        ciphertext: WordArray;
        toString(encoder?: Encoder): string;
      }

      interface WordArrayStatic {
        random(nBytes: number): WordArray;
      }

      interface CipherParamsStatic {
        create(params: { ciphertext: WordArray }): CipherParams;
      }
    }

    interface AesStatic {
      encrypt(
        message: string,
        key: lib.WordArray | string,
        options?: { iv?: lib.WordArray; mode?: object; padding?: object }
      ): lib.CipherParams;
      decrypt(
        ciphertext: lib.CipherParams | string,
        key: lib.WordArray | string,
        options?: { iv?: lib.WordArray; mode?: object; padding?: object }
      ): lib.WordArray;
    }

    interface CryptoJsStatic {
      AES: AesStatic;
      enc: {
        Base64: Encoder;
        Utf8: Encoder;
      };
      lib: {
        WordArray: lib.WordArrayStatic;
        CipherParams: lib.CipherParamsStatic;
      };
      mode: {
        CBC: object;
      };
      pad: {
        Pkcs7: object;
      };
    }
  }

  const CryptoJS: CryptoJS.CryptoJsStatic;
  export default CryptoJS;
}
