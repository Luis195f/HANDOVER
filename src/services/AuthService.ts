import AuthService from '@/src/security/AuthService';
import { ensureFreshAccessToken } from '@/src/security/auth';

export const getToken = ensureFreshAccessToken;

export { AuthService } from '@/src/security/AuthService';

export default { getToken, ...AuthService };
