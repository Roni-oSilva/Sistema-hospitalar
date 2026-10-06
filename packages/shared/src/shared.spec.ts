import {
  ACCESSIBILITY_FLAGS,
  ATTENDANCE_STATUSES,
  ALLOWED_TRANSITIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  accessibilitySchema,
  calcAge,
  canTransition,
  createPatientSchema,
  dayRange,
  effectiveAccessibilityFlags,
  formatAge,
  isValidCns,
  isValidCpf,
  localDateString,
  maskCns,
  maskCpf,
  medicalPriorityScore,
  normalizeText,
  vitalsSchema,
} from './index';

describe('CPF', () => {
  it('aceita CPF válido, com ou sem máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });
  it('rejeita CPF inválido, repetido ou de tamanho errado', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
});

describe('CNS', () => {
  it('valida CNS definitivo (1/2) e provisório (7/8/9) — números fictícios', () => {
    expect(isValidCns('100000000010002')).toBe(true);
    expect(isValidCns('200123456780003')).toBe(true);
    expect(isValidCns('700001234567894')).toBe(true);
    expect(isValidCns('898765432100121')).toBe(true);
  });
  it('rejeita CNS com dígito errado ou prefixo inexistente', () => {
    expect(isValidCns('100000000010003')).toBe(false);
    expect(isValidCns('700001234567895')).toBe(false);
    expect(isValidCns('300000000000000')).toBe(false);
    expect(isValidCns('1234')).toBe(false);
  });
});

describe('máscaras', () => {
  it('mostram só o final e não vazam o documento inteiro', () => {
    expect(maskCpf('52998224725')).toBe('***.***.***-25');
    expect(maskCns('700001234567894')).toBe('*** **** **** 7894');
    expect(maskCpf(null)).toBeNull();
  });
});

describe('texto', () => {
  it('normaliza acentos e caixa', () => {
    expect(normalizeText('  JOÃO   da  Conceição ')).toBe('joao da conceicao');
  });
});

describe('máquina de estados', () => {
  it('só permite as transições previstas', () => {
    expect(canTransition('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM')).toBe(true);
    expect(canTransition('AGUARDANDO_TRIAGEM', 'AGUARDANDO_MEDICO')).toBe(false);
    expect(canTransition('EM_TRIAGEM', 'AGUARDANDO_MEDICO')).toBe(true);
    expect(canTransition('AGUARDANDO_MEDICO', 'EM_ATENDIMENTO')).toBe(true);
    expect(canTransition('MEDICACAO_REGISTRADA', 'CANCELADO')).toBe(false);
    expect(canTransition('EM_ATENDIMENTO', 'CANCELADO')).toBe(false);
  });
  it('estados finais não têm saída', () => {
    expect(ALLOWED_TRANSITIONS.ATENDIMENTO_FINALIZADO).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS.CANCELADO).toHaveLength(0);
  });
  it('todos os estados estão mapeados', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ATTENDANCE_STATUSES].sort());
  });
});

describe('prioridade da fila', () => {
  it('ordena por nível de risco', () => {
    expect(medicalPriorityScore('EMERGENCIA', false, false)).toBeLessThan(medicalPriorityScore('MUITO_URGENTE', true, true));
    expect(medicalPriorityScore('URGENTE', false, true)).toBeLessThan(medicalPriorityScore('POUCO_URGENTE', true, true));
  });
  it('desempate legal só atua dentro do mesmo nível e quando habilitado', () => {
    expect(medicalPriorityScore('URGENTE', true, true)).toBeLessThan(medicalPriorityScore('URGENTE', false, true));
    expect(medicalPriorityScore('URGENTE', true, false)).toBe(medicalPriorityScore('URGENTE', false, false));
  });
});

describe('datas no fuso do hospital', () => {
  it('calcula o dia local em America/Belem (UTC−3)', () => {
    expect(localDateString(new Date('2026-10-07T02:30:00Z'), 'America/Belem')).toBe('2026-10-06');
    expect(localDateString(new Date('2026-10-07T03:00:00Z'), 'America/Belem')).toBe('2026-10-07');
  });
  it('dayRange cobre exatamente 24h locais', () => {
    const { start, end } = dayRange('2026-10-06', 'America/Belem');
    expect(start.toISOString()).toBe('2026-10-06T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-07T03:00:00.000Z');
  });
  it('calcula idade', () => {
    const ref = new Date('2026-10-06T15:00:00Z');
    expect(calcAge('1974-04-12', ref).years).toBe(52);
    expect(formatAge(calcAge('2026-07-01', ref))).toBe('3 meses');
    expect(formatAge(calcAge('2025-08-01', ref))).toBe('1 ano e 2 meses');
  });
});

describe('acessibilidade', () => {
  it('deriva idoso e criança da idade sem exigir marcação manual', () => {
    const ref = new Date('2026-10-06T15:00:00Z');
    expect(effectiveAccessibilityFlags([], '1950-01-01', ref)).toContain('IDOSO');
    expect(effectiveAccessibilityFlags([], '2020-01-01', ref)).toContain('CRIANCA');
    expect(effectiveAccessibilityFlags([], '1990-01-01', ref)).toEqual([]);
  });
  it('tipo de deficiência exige PCD; "outra" exige descrição', () => {
    expect(accessibilitySchema.safeParse({ flags: [], disabilityType: 'FISICA', needs: [] }).success).toBe(false);
    expect(accessibilitySchema.safeParse({ flags: ['PCD'], disabilityType: 'FISICA', needs: ['CADEIRA_DE_RODAS'] }).success).toBe(true);
    expect(accessibilitySchema.safeParse({ flags: ['OUTRA'], needs: [] }).success).toBe(false);
    expect(accessibilitySchema.safeParse({ flags: ['OUTRA'], needs: [], otherNeedDescription: 'Sala silenciosa' }).success).toBe(true);
  });
  it('nenhuma flag de acessibilidade é, por si só, um nível de risco', () => {
    // regra de negócio: acessibilidade ≠ emergência. O catálogo de flags não contém níveis de risco.
    expect(ACCESSIBILITY_FLAGS.some((f) => (f as string).includes('EMERG'))).toBe(false);
  });
});

describe('sinais vitais', () => {
  it('aceita campos parciais e vírgula decimal', () => {
    const r = vitalsSchema.safeParse({ temperatureC: '36,8', spo2: '94' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.temperatureC).toBe(36.8);
  });
  it('exige pressão completa e sistólica > diastólica', () => {
    expect(vitalsSchema.safeParse({ systolic: 120 }).success).toBe(false);
    expect(vitalsSchema.safeParse({ systolic: 80, diastolic: 120 }).success).toBe(false);
    expect(vitalsSchema.safeParse({ systolic: 150, diastolic: 95 }).success).toBe(true);
  });
  it('rejeita valores fora da faixa plausível e submissão vazia', () => {
    expect(vitalsSchema.safeParse({ spo2: 140 }).success).toBe(false);
    expect(vitalsSchema.safeParse({ painScale: 11 }).success).toBe(false);
    expect(vitalsSchema.safeParse({}).success).toBe(false);
  });
});

describe('cadastro de paciente', () => {
  const base = { fullName: 'Fulano de Tal Teste', birthDate: '1980-05-20', sex: 'MASCULINO' };
  it('normaliza CPF e telefones; usa padrões', () => {
    const r = createPatientSchema.safeParse({ ...base, cpf: '529.982.247-25', phones: [{ type: 'CELULAR', number: '(94) 99999-0000' }] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cpf).toBe('52998224725');
      expect(r.data.phones[0].number).toBe('94999990000');
      expect(r.data.nationality).toBe('Brasileira');
    }
  });
  it('rejeita CPF inválido, nome sem sobrenome e nascimento futuro', () => {
    expect(createPatientSchema.safeParse({ ...base, cpf: '111.111.111-11' }).success).toBe(false);
    expect(createPatientSchema.safeParse({ ...base, fullName: 'Fulano' }).success).toBe(false);
    expect(createPatientSchema.safeParse({ ...base, birthDate: '2999-01-01' }).success).toBe(false);
  });
  it('campos opcionais vazios não geram erro', () => {
    expect(createPatientSchema.safeParse({ ...base, cpf: '', cns: '', rg: '', motherName: '' }).success).toBe(true);
  });
});

describe('permissões padrão (menor privilégio)', () => {
  it('recepção não lê dados clínicos', () => {
    const rec = DEFAULT_ROLE_PERMISSIONS.RECEPCAO;
    expect(rec).not.toContain(PERMISSIONS.TRIAGE_READ);
    expect(rec).not.toContain(PERMISSIONS.CONSULTATION_READ);
  });
  it('administrador não lê dados clínicos por padrão', () => {
    const adm = DEFAULT_ROLE_PERMISSIONS.ADMINISTRADOR;
    expect(adm).not.toContain(PERMISSIONS.TRIAGE_READ);
    expect(adm).not.toContain(PERMISSIONS.CONSULTATION_READ);
    expect(adm).toContain(PERMISSIONS.AUDIT_READ);
  });
  it('só triagem e médico classificam risco; recepção nunca', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.TRIAGEM).toContain(PERMISSIONS.TRIAGE_CLASSIFY);
    expect(DEFAULT_ROLE_PERMISSIONS.MEDICO).toContain(PERMISSIONS.TRIAGE_CLASSIFY);
    expect(DEFAULT_ROLE_PERMISSIONS.RECEPCAO).not.toContain(PERMISSIONS.TRIAGE_CLASSIFY);
  });
});
