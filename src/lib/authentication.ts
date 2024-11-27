import process from 'process';
import jwt from 'jsonwebtoken';
import ChtSession from './cht-session';

const LOGIN_EXPIRES_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
const QUEUE_SESSION_EXPIRATION = '96h';
const { COOKIE_PRIVATE_KEY, WORKER_PRIVATE_KEY } = process.env;
const PRIVATE_KEY_SALT = '_'; // change to logout all users
const COOKIE_SIGNING_KEY = COOKIE_PRIVATE_KEY + PRIVATE_KEY_SALT;

export default class Auth {
  public static AUTH_COOKIE_NAME = 'AuthToken';

  public static assertEnvironmentSetup() {
    if (!COOKIE_PRIVATE_KEY) {
      throw new Error('.env missing COOKIE_PRIVATE_KEY');
    }
    if (!WORKER_PRIVATE_KEY) {
      throw new Error('.env missing WORKER_PRIVATE_KEY');
    }
    if (COOKIE_PRIVATE_KEY === WORKER_PRIVATE_KEY) {
      throw new Error('COOKIE_PRIVATE_KEY should be different from WORKER_PRIVATE_KEY');
    }
  }

  private static encodeToken(session: ChtSession, signingKey: string, expiresIn: string) {
    const data = JSON.stringify(session);
    return jwt.sign({ data }, signingKey, { expiresIn });
  }

  private static decodeToken(token: string, signingKey: string): ChtSession {
    if (!token) {
      throw new Error('invalid authentication token');
    }

    const { data } = jwt.verify(token, signingKey) as any;
    return ChtSession.createFromDataString(data);
  }

  public static encodeTokenForCookie(session: ChtSession) {
    return this.encodeToken(session, COOKIE_SIGNING_KEY, '1 day');
  }

  public static decodeTokenForCookie(token: string): ChtSession {
    return this.decodeToken(token, COOKIE_SIGNING_KEY);
  }

  public static encodeTokenForWorker(session: ChtSession) {
    return this.encodeToken(session, `${WORKER_PRIVATE_KEY}`, QUEUE_SESSION_EXPIRATION);
  }

  public static decodeTokenForWorker(token: string): ChtSession {
    return this.decodeToken(token, `${WORKER_PRIVATE_KEY}`);
  }

  public static cookieExpiry() {
    return new Date(new Date().getTime() + LOGIN_EXPIRES_AFTER_MS);
  }
}
