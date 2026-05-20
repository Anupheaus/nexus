import crypto from 'crypto';
import { promisify } from 'util';
import JWT from 'jsonwebtoken';

const generateKeyPairAsync = promisify(crypto.generateKeyPair);
import { Error, InternalError, is } from '@anupheaus/common';
import { jwt as commonJwt } from '../common';
import type { NexusUser } from '../common';

export interface GeneratedToken {
  token: string;
  publicKey: string;
  privateKey: string;
}

function extractUserFromToken(token: string, key: string): NexusUser | undefined {
  try {
    const pemKey = Buffer.from(key, 'base64').toString('utf-8');
    const data = JWT.verify(token, pemKey, { issuer: 'socket-api', audience: 'socket-api' });
    if (is.string(data) || !is.plainObject(data) || !('user' in data)) throw new InternalError('The format of the token is invalid.');
    return data.user as NexusUser;
  } catch (e) {
    if (e instanceof JWT.TokenExpiredError) {
      throw new InternalError('The token has expired.', { error: e });
    } else if (e instanceof Error) {
      throw new InternalError('An unexpected error occurred while verifying the token.', { error: e });
    } else {
      throw new InternalError('An unexpected error occurred while verifying the token.');
    }
  }
}

async function createTokenFromUser(user: NexusUser, providedPrivateKey?: string): Promise<GeneratedToken> {
  const { rawPrivateKey, rawPublicKey } = await (async () => {
    if (is.empty(providedPrivateKey)) {
      const keyPair = await generateKeyPairAsync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem',
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem',
        },
      });
      return { rawPrivateKey: keyPair.privateKey, rawPublicKey: keyPair.publicKey };
    } else {
      const pubKeyObject = crypto.createPublicKey({
        key: providedPrivateKey,
        format: 'pem'
      });
      return { rawPrivateKey: providedPrivateKey, rawPublicKey: pubKeyObject.export({ format: 'pem', type: 'spki' }) as string };
    }
  })();

  const token = JWT.sign({ user }, rawPrivateKey, {
    algorithm: 'RS256',
    issuer: 'socket-api',
    audience: 'socket-api',
    expiresIn: '3d',
    encoding: 'utf-8',
    header: { alg: 'RS256' },
  });

  const privateKey = Buffer.from(rawPrivateKey, 'utf-8').toString('base64');
  const publicKey = Buffer.from(rawPublicKey, 'utf-8').toString('base64');

  return { token, publicKey, privateKey };
}

function encodePrivateKey(privateKey: string | undefined): string | undefined {
  if (is.empty(privateKey)) return undefined;
  return Buffer.from(privateKey, 'utf-8').toString('base64');
}

export const jwt = {
  createTokenFromUser,
  extractUserFromToken,
  extractUntrustedUserFromToken: commonJwt.extractUntrustedUserFromToken,
  encodePrivateKey,
};

