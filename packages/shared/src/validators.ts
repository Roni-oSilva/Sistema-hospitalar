/** Validadores e normalizadores de documentos brasileiros. Funções puras, sem dependências. */

export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

/**
 * Cartão Nacional de Saúde (CNS), 15 dígitos.
 * - Iniciado em 1 ou 2: número definitivo (derivado do PIS) com dígito verificador.
 * - Iniciado em 7, 8 ou 9: número provisório, soma ponderada divisível por 11.
 */
export function isValidCns(input: string): boolean {
  const cns = onlyDigits(input);
  if (cns.length !== 15) return false;
  const first = cns[0];
  if (first === '1' || first === '2') {
    const pis = cns.slice(0, 11);
    let sum = 0;
    for (let i = 0; i < 11; i++) sum += Number(pis[i]) * (15 - i);
    let dv = 11 - (sum % 11);
    if (dv === 11) dv = 0;
    let result: string;
    if (dv === 10) {
      sum += 2;
      dv = 11 - (sum % 11);
      result = `${pis}001${dv}`;
    } else {
      result = `${pis}000${dv}`;
    }
    return result === cns;
  }
  if (first === '7' || first === '8' || first === '9') {
    let sum = 0;
    for (let i = 0; i < 15; i++) sum += Number(cns[i]) * (15 - i);
    return sum % 11 === 0;
  }
  return false;
}

/** Telefones brasileiros: DDD + 8 (fixo) ou 9 dígitos (celular). */
export function isValidPhone(input: string): boolean {
  const digits = onlyDigits(input);
  return digits.length === 10 || digits.length === 11;
}

export function formatCpf(digits: string): string {
  const d = onlyDigits(digits);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : digits;
}

export function formatCns(digits: string): string {
  const d = onlyDigits(digits);
  return d.length === 15 ? `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7, 11)} ${d.slice(11)}` : digits;
}

export function formatPhone(digits: string): string {
  const d = onlyDigits(digits);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

/** Exibe só o final: usado em listas/buscas para quem não tem permissão de ver o documento completo. */
export function maskCpf(digits: string | null | undefined): string | null {
  if (!digits) return null;
  const d = onlyDigits(digits);
  return d.length === 11 ? `***.***.***-${d.slice(9)}` : '***';
}

export function maskCns(digits: string | null | undefined): string | null {
  if (!digits) return null;
  const d = onlyDigits(digits);
  return d.length === 15 ? `*** **** **** ${d.slice(11)}` : '***';
}

export function maskRg(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > 3 ? `${'*'.repeat(value.length - 3)}${value.slice(-3)}` : '***';
}

/** Minúsculas, sem acentos, espaços colapsados — usado para busca por nome e detecção de duplicidade. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
