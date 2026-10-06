import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { APP_CONFIG, AppConfig } from '../config/env';

/** Hash de senha com argon2id (memory-hard). O hash nunca sai da API. */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options;
  /** Hash descartável: comparar contra ele quando o usuário não existe iguala o tempo de resposta (anti-enumeração). */
  private dummyHash: Promise<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.options = { type: argon2.argon2id, memoryCost: config.argon2.memoryCost, timeCost: config.argon2.timeCost, parallelism: 1 };
    this.dummyHash = argon2.hash('senha-descartavel-para-igualar-tempo', this.options);
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  async verifyDummy(plain: string): Promise<void> {
    await this.verify(await this.dummyHash, plain);
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.options);
  }
}
