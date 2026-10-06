/** Usuários e consultórios fictícios do banco de teste. */
export const TEST_PASSWORD = 'SenhaDeTeste2026';

export interface TestUser {
  username: string;
  fullName: string;
  role: 'ADMINISTRADOR' | 'RECEPCAO' | 'TRIAGEM' | 'MEDICO';
  sector: string;
  register?: string;
}

export const TEST_USERS: TestUser[] = [
  { username: 't.admin', fullName: 'Admin Teste', role: 'ADMINISTRADOR', sector: 'ADMINISTRACAO' },
  { username: 't.recepcao', fullName: 'Recepção Teste', role: 'RECEPCAO', sector: 'RECEPCAO' },
  { username: 't.triagem', fullName: 'Triagem Teste', role: 'TRIAGEM', sector: 'TRIAGEM', register: 'COREN-TESTE 1' },
  { username: 't.triagem2', fullName: 'Triagem Teste 2', role: 'TRIAGEM', sector: 'TRIAGEM', register: 'COREN-TESTE 2' },
  { username: 't.medico', fullName: 'Médica Teste', role: 'MEDICO', sector: 'CONSULTORIOS', register: 'CRM-TESTE 1' },
  { username: 't.medico2', fullName: 'Médico Teste 2', role: 'MEDICO', sector: 'CONSULTORIOS', register: 'CRM-TESTE 2' },
  { username: 't.medico3', fullName: 'Médico Teste 3', role: 'MEDICO', sector: 'CONSULTORIOS', register: 'CRM-TESTE 3' },
  { username: 't.bloqueio', fullName: 'Usuário Bloqueio Teste', role: 'RECEPCAO', sector: 'RECEPCAO' },
];

export const TEST_ROOMS = ['Consultório A', 'Consultório B', 'Consultório C'];

/** CPF válido gerado a partir de uma base aleatória (só existe no banco de teste, que é recriado a cada execução). */
export function randomCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (base.every((d) => d === base[0])) base[0] = (base[0] + 1) % 10;
  const dv = (digits: number[]) => {
    const sum = digits.reduce((s, d, i) => s + d * (digits.length + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

let counter = 0;
/** Nome fictício único por teste (evita o alerta de "possível duplicidade" entre testes). */
export function uniqueName(prefix = 'Paciente Teste'): string {
  counter += 1;
  return `${prefix} ${Date.now().toString(36)} ${counter} Silva`;
}
