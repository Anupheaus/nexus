declare module 'selfsigned-ca' {
  interface CertSubject {
    commonName?: string;
    countryName?: string;
    stateOrProvinceName?: string;
    localityName?: string;
    organizationName?: string;
    organizationalUnitName?: string;
    emailAddress?: string;
  }

  interface CertAltName {
    type: number;
    value?: string;
    ip?: string;
  }

  interface CertExtension {
    name: string;
    altNames?: CertAltName[];
    [key: string]: unknown;
  }

  export interface CertOptions {
    days?: number;
    keySize?: number;
    algorithm?: string;
    serialNumber?: number;
    subject?: CertSubject;
    issuer?: CertSubject;
    extensions?: CertExtension[];
  }

  export class Cert {
    name?: string;
    crtPath?: string;
    keyPath?: string;
    cert?: Buffer | string;
    key?: Buffer | string;
    caCert?: Buffer | string;
    serialNumber?: string;
    thumbPrint?: string;
    hash?: string;
    privateKey: unknown;
    publicKey: unknown;
    certificate: unknown;

    constructor(crtPath?: string, keyPath?: string);
    load(): Promise<void>;
    save(): Promise<void>;
    install(): Promise<void>;
    isInstalled(): Promise<boolean>;
    createRootCa(options: CertOptions | string): this;
    create(options: CertOptions | string, caCert?: Cert): this;
  }

  export function createRootCa(options: CertOptions | string, name?: string): Cert;
  export function create(options: CertOptions | string, caCert?: Cert, name?: string): Cert;
}
