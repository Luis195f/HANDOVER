import AuthService from '@/src/security/AuthService';

export const getToken = AuthService.getAccessToken;

export { AuthService } from '@/src/security/AuthService';

export default { getToken, ...AuthService };
