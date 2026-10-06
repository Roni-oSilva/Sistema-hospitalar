import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  CreatePatientInput,
  PERMISSIONS,
  PatientSearchInput,
  UpdatePatientInput,
  maskCns,
  maskCpf,
  maskRg,
  normalizeText,
  onlyDigits,
} from '@hospital/shared';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Actor, can } from '../auth/auth.types';
import { ErrorCodes, conflict, notFound } from '../common/errors/app-error';
import { accessibilityDto, dateOnly, patientBasic, toDateOnlyDate } from '../attendances/attendance.mapper';

const PATIENT_INCLUDE = {
  contacts: { orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }] },
  addresses: { where: { isCurrent: true }, take: 1 },
  guardian: true,
  accessibility: true,
} satisfies Prisma.PatientInclude;

type PatientFull = Prisma.PatientGetPayload<{ include: typeof PATIENT_INCLUDE }>;

const maskPhone = (n: string): string => (n.length >= 4 ? `${'*'.repeat(n.length - 4)}${n.slice(-4)}` : '****');

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────── busca ─────────────────────────────

  private nameTokens(text: string): Prisma.PatientWhereInput[] {
    return normalizeText(text)
      .split(' ')
      .filter(Boolean)
      .map((t) => ({ normalizedName: { contains: t } }));
  }

  private freeText(q: string): Prisma.PatientWhereInput {
    const text = q.trim();
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (br) return { birthDate: toDateOnlyDate(`${br[3]}-${br[2]}-${br[1]}`) };
    if (/^[\d.\-\s()/]+$/.test(text)) {
      const d = onlyDigits(text);
      if (d.length === 11) return { OR: [{ cpf: d }, { contacts: { some: { number: d } } }] };
      if (d.length === 15) return { cns: d };
      if (d.length === 10) return { contacts: { some: { number: d } } };
      if (d.length >= 1 && d.length <= 9) return { OR: [{ recordNumber: Number(d) }, ...(d.length >= 4 ? [{ cpf: { startsWith: d } }] : [])] };
      return { cpf: { startsWith: d } };
    }
    return { AND: this.nameTokens(text) };
  }

  async search(actor: Actor, input: PatientSearchInput) {
    const and: Prisma.PatientWhereInput[] = [];
    const criteria: string[] = [];
    if (input.q) { criteria.push('q'); and.push(this.freeText(input.q)); }
    if (input.cpf) {
      criteria.push('cpf');
      const d = onlyDigits(input.cpf);
      and.push(d.length === 11 ? { cpf: d } : { cpf: { startsWith: d } });
    }
    if (input.cns) {
      criteria.push('cns');
      const d = onlyDigits(input.cns);
      and.push(d.length === 15 ? { cns: d } : { cns: { startsWith: d } });
    }
    if (input.name) { criteria.push('name'); and.push(...this.nameTokens(input.name)); }
    if (input.birthDate) { criteria.push('birthDate'); and.push({ birthDate: toDateOnlyDate(input.birthDate) }); }
    if (input.recordNumber) {
      criteria.push('recordNumber');
      const n = Number(onlyDigits(input.recordNumber));
      and.push({ recordNumber: Number.isSafeInteger(n) && n < 2_147_483_647 ? n : -1 });
    }
    if (input.phone) {
      criteria.push('phone');
      const d = onlyDigits(input.phone);
      and.push({ contacts: { some: { number: d.length >= 10 ? d : { endsWith: d } } } });
    }

    const rows = await this.prisma.patient.findMany({
      where: { AND: and },
      include: {
        accessibility: true,
        contacts: { take: 1, orderBy: { isPrimary: 'desc' } },
        // um paciente com atendimento em andamento: a recepção vê ANTES de tentar criar outro
        attendances: { where: { status: { in: [...ACTIVE_STATUSES] } }, take: 1, select: { id: true, code: true, status: true } },
      },
      orderBy: [{ normalizedName: 'asc' }],
      take: input.limit,
    });

    // a trilha registra QUE houve busca e por quais critérios — nunca o valor digitado (pode ser CPF)
    await this.audit.record(this.prisma, actor, { action: 'PATIENT_SEARCH', entityType: 'Patient', metadata: { criteria, results: rows.length } });

    const now = new Date();
    return rows.map((p) => ({
      ...patientBasic(p, now),
      cpfMasked: maskCpf(p.cpf),
      cnsMasked: maskCns(p.cns),
      phoneMasked: p.contacts[0] ? maskPhone(p.contacts[0].number) : null,
      accessibility: accessibilityDto(p.accessibility, p.birthDate),
      activeAttendance: p.attendances[0] ?? null,
    }));
  }

  // ───────────────────────────── leitura ─────────────────────────────

  toDto(p: PatientFull, actor: Actor) {
    const full = can(actor, PERMISSIONS.PATIENTS_VIEW_DOCUMENTS);
    const address = p.addresses[0];
    return {
      ...patientBasic(p),
      cpf: full ? p.cpf : maskCpf(p.cpf),
      cns: full ? p.cns : maskCns(p.cns),
      rg: full ? p.rg : maskRg(p.rg),
      documentsMasked: !full,
      nationality: p.nationality,
      birthplace: p.birthplace,
      motherName: p.motherName,
      phones: p.contacts.map((c) => ({ type: c.type, number: c.number, isPrimary: c.isPrimary })),
      address: address
        ? { street: address.street, number: address.number, complement: address.complement, neighborhood: address.neighborhood, city: address.city, state: address.state, zipCode: address.zipCode }
        : null,
      guardian: p.guardian
        ? { name: p.guardian.name, cpf: full ? p.guardian.cpf : maskCpf(p.guardian.cpf), relationship: p.guardian.relationship, phone: p.guardian.phone }
        : null,
      accessibility: accessibilityDto(p.accessibility, p.birthDate),
      version: p.version,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async get(actor: Actor, id: string) {
    const p = await this.prisma.patient.findUnique({ where: { id }, include: PATIENT_INCLUDE });
    if (!p) throw notFound('Paciente não encontrado.');
    await this.audit.record(this.prisma, actor, { action: 'PATIENT_VIEWED', entityType: 'Patient', entityId: p.id, patientId: p.id });
    return this.toDto(p, actor);
  }

  /** Visitas anteriores, sem conteúdo clínico (status e datas). */
  async attendances(actor: Actor, patientId: string) {
    const rows = await this.prisma.attendance.findMany({
      where: { patientId },
      orderBy: { arrivedAt: 'desc' },
      take: 30,
      select: { id: true, code: true, status: true, arrivedAt: true, finishedAt: true, reason: true },
    });
    await this.audit.record(this.prisma, actor, { action: 'PATIENT_VISITS_VIEWED', entityType: 'Patient', entityId: patientId, patientId });
    return rows.map((a) => ({ ...a, arrivedAt: a.arrivedAt.toISOString(), finishedAt: a.finishedAt?.toISOString() ?? null }));
  }

  // ───────────────────────────── escrita ─────────────────────────────

  private normalizedName(fullName: string, socialName?: string | null): string {
    return [normalizeText(fullName), socialName ? normalizeText(socialName) : ''].filter(Boolean).join(' ');
  }

  private async assertNoDocumentDuplicate(tx: Tx, input: { cpf?: string | null; cns?: string | null }, excludeId?: string): Promise<void> {
    const or: Prisma.PatientWhereInput[] = [];
    if (input.cpf) or.push({ cpf: input.cpf });
    if (input.cns) or.push({ cns: input.cns });
    if (or.length === 0) return;
    const existing = await tx.patient.findFirst({
      where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, fullName: true, recordNumber: true, cpf: true },
    });
    if (existing) {
      const by = input.cpf && existing.cpf === input.cpf ? 'CPF' : 'CNS';
      throw conflict(`Já existe um paciente cadastrado com este ${by}: ${existing.fullName}.`, ErrorCodes.DUPLICATE_DOCUMENT, {
        patientId: existing.id,
        fullName: existing.fullName,
        recordNumber: String(existing.recordNumber).padStart(6, '0'),
      });
    }
  }

  private async assertNoLikelyDuplicate(tx: Tx, fullName: string, birthDate: string, confirmed: boolean, excludeId?: string): Promise<void> {
    if (confirmed) return;
    const candidates = await tx.patient.findMany({
      where: { normalizedName: { startsWith: normalizeText(fullName) }, birthDate: toDateOnlyDate(birthDate), ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, fullName: true, recordNumber: true, motherName: true },
      take: 5,
    });
    if (candidates.length > 0) {
      throw conflict('Já existe um cadastro com o mesmo nome e data de nascimento. Confira antes de criar outro.', ErrorCodes.POSSIBLE_DUPLICATE, {
        candidates: candidates.map((c) => ({ id: c.id, fullName: c.fullName, recordNumber: String(c.recordNumber).padStart(6, '0'), motherName: c.motherName })),
      });
    }
  }

  private writableFields(input: CreatePatientInput | UpdatePatientInput) {
    return {
      fullName: input.fullName,
      socialName: input.socialName ?? null,
      normalizedName: this.normalizedName(input.fullName, input.socialName),
      cpf: input.cpf ?? null,
      cns: input.cns ?? null,
      rg: input.rg ?? null,
      birthDate: toDateOnlyDate(input.birthDate),
      sex: input.sex,
      nationality: input.nationality,
      birthplace: input.birthplace ?? null,
      motherName: input.motherName ?? null,
    };
  }

  private async writeRelations(tx: Tx, patientId: string, input: CreatePatientInput | UpdatePatientInput, actor: Actor): Promise<void> {
    // telefones: substitui o conjunto (a auditoria registra a alteração)
    await tx.patientContact.deleteMany({ where: { patientId } });
    if (input.phones.length > 0) {
      await tx.patientContact.createMany({ data: input.phones.map((p, i) => ({ patientId, type: p.type, number: p.number, isPrimary: i === 0 })) });
    }

    // endereço: mantém histórico (o anterior deixa de ser o vigente)
    const addr = input.address;
    const hasAddress = Object.values(addr).some((v) => v !== undefined && v !== '');
    const current = await tx.patientAddress.findFirst({ where: { patientId, isCurrent: true } });
    const same = (a: string | null | undefined, b: string | undefined) => (a ?? '') === (b ?? '');
    const unchanged =
      current && hasAddress &&
      same(current.street, addr.street) && same(current.number, addr.number) && same(current.complement, addr.complement) &&
      same(current.neighborhood, addr.neighborhood) && same(current.city, addr.city) && same(current.state, addr.state) && same(current.zipCode, addr.zipCode);
    if (!unchanged) {
      if (current) await tx.patientAddress.update({ where: { id: current.id }, data: { isCurrent: false } });
      if (hasAddress) {
        await tx.patientAddress.create({
          data: { patientId, street: addr.street, number: addr.number, complement: addr.complement, neighborhood: addr.neighborhood, city: addr.city, state: addr.state, zipCode: addr.zipCode, isCurrent: true },
        });
      }
    }

    // responsável/acompanhante
    if (input.guardian) {
      const g = input.guardian;
      await tx.patientGuardian.upsert({
        where: { patientId },
        create: { patientId, name: g.name, cpf: g.cpf ?? null, relationship: g.relationship, phone: g.phone ?? null },
        update: { name: g.name, cpf: g.cpf ?? null, relationship: g.relationship, phone: g.phone ?? null },
      });
    } else if (input.guardian === null) {
      await tx.patientGuardian.deleteMany({ where: { patientId } });
    }

    // perfil permanente de acessibilidade
    const acc = input.accessibility;
    await tx.patientAccessibility.upsert({
      where: { patientId },
      create: { patientId, flags: acc.flags, disabilityType: acc.disabilityType ?? null, needs: acc.needs, otherNeedDescription: acc.otherNeedDescription ?? null, updatedById: actor.userId },
      update: { flags: acc.flags, disabilityType: acc.disabilityType ?? null, needs: acc.needs, otherNeedDescription: acc.otherNeedDescription ?? null, updatedById: actor.userId },
    });
  }

  async create(actor: Actor, input: CreatePatientInput) {
    const created = await this.prisma.run(async (tx) => {
      await this.assertNoDocumentDuplicate(tx, input);
      await this.assertNoLikelyDuplicate(tx, input.fullName, input.birthDate, input.confirmNotDuplicate);
      const patient = await tx.patient.create({ data: { ...this.writableFields(input), createdById: actor.userId } });
      await this.writeRelations(tx, patient.id, input, actor);
      await this.audit.record(tx, actor, {
        action: 'PATIENT_CREATED',
        entityType: 'Patient',
        entityId: patient.id,
        patientId: patient.id,
        metadata: { recordNumber: patient.recordNumber, confirmedNotDuplicate: input.confirmNotDuplicate || undefined },
      });
      return tx.patient.findUniqueOrThrow({ where: { id: patient.id }, include: PATIENT_INCLUDE });
    });
    return this.toDto(created, actor);
  }

  async update(actor: Actor, id: string, input: UpdatePatientInput) {
    const updated = await this.prisma.run(async (tx) => {
      const before = await tx.patient.findUnique({ where: { id }, include: PATIENT_INCLUDE });
      if (!before) throw notFound('Paciente não encontrado.');
      await this.assertNoDocumentDuplicate(tx, input, id);
      await this.assertNoLikelyDuplicate(tx, input.fullName, input.birthDate, input.confirmNotDuplicate, id);

      // controle de concorrência otimista: só atualiza se ninguém alterou desde que o usuário abriu o cadastro
      const res = await tx.patient.updateMany({
        where: { id, version: input.expectedVersion },
        data: { ...this.writableFields(input), updatedById: actor.userId, version: { increment: 1 } },
      });
      if (res.count !== 1) {
        throw conflict('Este cadastro foi alterado por outro usuário. Recarregue para ver as mudanças antes de salvar.', ErrorCodes.EDIT_CONFLICT);
      }
      await this.writeRelations(tx, id, input, actor);
      const after = await tx.patient.findUniqueOrThrow({ where: { id }, include: PATIENT_INCLUDE });

      const flat = (p: PatientFull) => ({
        fullName: p.fullName, socialName: p.socialName, cpf: p.cpf, cns: p.cns, rg: p.rg, birthDate: dateOnly(p.birthDate), sex: p.sex,
        nationality: p.nationality, birthplace: p.birthplace, motherName: p.motherName,
        phones: p.contacts.map((c) => c.number).join(','),
        address: p.addresses[0] ? [p.addresses[0].street, p.addresses[0].number, p.addresses[0].neighborhood, p.addresses[0].city, p.addresses[0].state].join('|') : null,
        guardian: p.guardian ? p.guardian.name : null,
        accessibilityFlags: p.accessibility?.flags.join(',') ?? null,
        disabilityType: p.accessibility?.disabilityType ?? null,
        accessibilityNeeds: p.accessibility?.needs.join(',') ?? null,
      });
      const changes = this.audit.diff(flat(before), flat(after), { mask: { cpf: (v) => maskCpf(v as string | null), cns: (v) => maskCns(v as string | null), rg: (v) => maskRg(v as string | null), phones: () => '[alterado]' } });
      await this.audit.record(tx, actor, {
        action: 'PATIENT_UPDATED',
        entityType: 'Patient',
        entityId: id,
        patientId: id,
        ...(changes ? { changes } : {}),
      });
      return after;
    });
    return this.toDto(updated, actor);
  }
}
