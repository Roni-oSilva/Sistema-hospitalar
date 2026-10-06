import { parseConfig } from './env';

const base = { WEB_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'postgresql://u:p@localhost:5432/hospital_dev' };

describe('configuração de ambiente', () => {
  it('aceita a configuração de desenvolvimento', () => {
    const c = parseConfig({ ...base, APP_ENV: 'development' });
    expect(c.databaseName).toBe('hospital_dev');
    expect(c.cookieSecure).toBe(false);
    expect(c.cookieName).toBe('hosp_session');
  });

  it('recusa desenvolvimento apontando para banco de produção', () => {
    expect(() => parseConfig({ ...base, APP_ENV: 'development', DATABASE_URL: 'postgresql://u:p@db:5432/hospital_prod' })).toThrow(/insegura/);
  });

  it('recusa produção apontando para banco de desenvolvimento/teste', () => {
    expect(() => parseConfig({ ...base, APP_ENV: 'production', WEB_ORIGIN: 'https://h.example', DATABASE_URL: 'postgresql://u:p@db:5432/hospital_test' })).toThrow(/insegura/);
  });

  it('em produção exige HTTPS e cookie seguro (prefixo __Host-)', () => {
    const prod = { APP_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/hospital_production' };
    expect(() => parseConfig({ ...prod, WEB_ORIGIN: 'http://h.example' })).toThrow(/https/);
    expect(() => parseConfig({ ...prod, WEB_ORIGIN: 'https://h.example', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    const ok = parseConfig({ ...prod, WEB_ORIGIN: 'https://h.example' });
    expect(ok.cookieSecure).toBe(true);
    expect(ok.cookieName).toBe('__Host-hosp_session');
  });

  it('falha cedo com mensagem clara quando falta variável obrigatória', () => {
    expect(() => parseConfig({ APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' })).toThrow(/DATABASE_URL/);
  });
});
