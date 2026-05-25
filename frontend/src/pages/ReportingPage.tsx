import { Card, Empty, Select, Space, Statistic, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getAdminReviewSlaSettings, listDocumentsRegistry } from "../api";
import type { DocumentRegistryItem, MDRRecord, ProjectItem, RegistryRevisionItem } from "../types";

interface Props {
  projects: ProjectItem[];
  mdr: MDRRecord[];
}

interface AdminSla {
  owner_specialist_review_days: number;
  contractor_co_rj_issue_days: number;
  owner_final_approval_days: number;
}

// Фиксированные веса этапов жизненного цикла документа.
// Накопительный прогресс одного документа = STAGES[k].weight × doc.weight / 100.
const STAGES = [
  { weight: 70, title: "Выпуск ревизии A (IFR)" },
  { weight: 75, title: "Рассмотрение ревизии A заказчиком" },
  { weight: 80, title: "Выпуск ревизии B (IFR)" },
  { weight: 85, title: "Циклы рассмотрения до AP" },
  { weight: 90, title: "Выпуск ревизии 00 (AFD)" },
  { weight: 100, title: "Получение AP по AFD" },
] as const;

const PLAN_INITIAL_DAYS = 20; // план — длительность от planned_dev_start до выпуска A

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateRu(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// Плановые даты 6 этапов для документа (с учётом SLA-настроек).
function plannedStageDates(item: DocumentRegistryItem, sla: AdminSla | null): (Date | null)[] {
  const base = toDate(item.planned_dev_start) ?? toDate(item.first_upload_date);
  if (!base) return [null, null, null, null, null, null];
  const review = sla?.owner_specialist_review_days ?? 8;
  const reissue = sla?.contractor_co_rj_issue_days ?? 8;
  const final = sla?.owner_final_approval_days ?? 2;
  const p70 = addDays(base, PLAN_INITIAL_DAYS);
  const p75 = addDays(p70, review);
  const p80 = addDays(p75, reissue);
  const p85 = addDays(p80, review);
  const p90 = addDays(p85, reissue);
  const p100 = addDays(p90, final);
  return [p70, p75, p80, p85, p90, p100];
}

// Фактические даты 6 этапов для документа на основе текущих ревизий.
function actualStageDates(revs: RegistryRevisionItem[]): (Date | null)[] {
  const sorted = [...revs].sort((a, b) => a.id - b.id);
  const ifrs = sorted.filter((r) => (r.issue_purpose ?? "").toUpperCase() === "IFR");
  const afdRev = sorted.find((r) => (r.issue_purpose ?? "").toUpperCase() === "AFD") ?? null;
  const revA = ifrs[0] ?? null;
  const revB = ifrs[1] ?? null;
  const lastIfrAp = [...ifrs].reverse().find((r) => r.review_code === "AP") ?? null;

  const f70 = revA ? toDate(revA.created_at) : null;

  // 75 — момент, когда A получила решение LR. Прокси: появление B/AFD,
  // либо own.created_at если на A уже есть review_code.
  let f75: Date | null = null;
  if (revB) f75 = toDate(revB.created_at);
  else if (afdRev) f75 = toDate(afdRev.created_at);
  else if (revA?.review_code) f75 = toDate(revA.created_at);

  const f80 = revB ? toDate(revB.created_at) : null;

  // 85 — закрытие IFR-циклов на AP. Прокси: AFD создан (после AP),
  // либо last IFR с AP уже зафиксирована.
  let f85: Date | null = null;
  if (afdRev) f85 = toDate(afdRev.created_at);
  else if (lastIfrAp) f85 = toDate(lastIfrAp.created_at);

  const f90 = afdRev ? toDate(afdRev.created_at) : null;
  const f100 = afdRev?.review_code === "AP" ? toDate(afdRev.created_at) : null;

  return [f70, f75, f80, f85, f90, f100];
}

// Текущий вес-процент для документа на дату t.
function progressPercentAt(stageDates: (Date | null)[], t: Date): number {
  let max = 0;
  for (let i = 0; i < STAGES.length; i++) {
    const sd = stageDates[i];
    if (sd && sd.getTime() <= t.getTime()) max = STAGES[i].weight;
  }
  return max;
}

export default function ReportingPage({ projects, mdr }: Props): JSX.Element {
  const [projectCode, setProjectCode] = useState<string | null>(projects[0]?.code ?? null);
  const [rows, setRows] = useState<DocumentRegistryItem[]>([]);
  const [sla, setSla] = useState<AdminSla | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projects.length) {
      setProjectCode(null);
      return;
    }
    if (!projectCode || !projects.some((p) => p.code === projectCode)) {
      setProjectCode(projects[0].code);
    }
  }, [projectCode, projects]);

  useEffect(() => {
    if (!projectCode) {
      setRows([]);
      return;
    }
    setLoading(true);
    void listDocumentsRegistry({ project_code: projectCode, for_reporting: true })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [projectCode]);

  useEffect(() => {
    void getAdminReviewSlaSettings()
      .then((s) =>
        setSla({
          owner_specialist_review_days: s.owner_specialist_review_days,
          contractor_co_rj_issue_days: s.contractor_co_rj_issue_days,
          owner_final_approval_days: s.owner_final_approval_days,
        }),
      )
      .catch(() => setSla(null));
  }, []);

  const mdrByDoc = useMemo(() => new Map(mdr.map((m) => [m.doc_number, m])), [mdr]);

  // Собираем нормализованные точки на документ: вес + плановые/фактические даты этапов.
  const docs = useMemo(
    () =>
      rows.map((r) => {
        const mdrRow = mdrByDoc.get(r.document_num);
        const weight = Math.max(0, Number(mdrRow?.doc_weight ?? 0)) || 1;
        return {
          key: r.document_id,
          num: r.document_num,
          title: r.document_title,
          weight,
          planned: plannedStageDates(r, sla),
          actual: actualStageDates(r.revisions),
        };
      }),
    [rows, mdrByDoc, sla],
  );

  // Точки S-кривой: для каждой релевантной даты — накопительный план и факт.
  const curve = useMemo(() => {
    if (!docs.length) return [] as { date: string; plan: number; fact: number }[];
    const dateSet = new Set<string>();
    docs.forEach((d) => {
      d.planned.forEach((p) => p && dateSet.add(toIso(p)));
      d.actual.forEach((a) => a && dateSet.add(toIso(a)));
    });
    dateSet.add(toIso(new Date()));
    const sorted = [...dateSet].filter(Boolean).sort();
    return sorted.map((iso) => {
      const t = new Date(iso);
      let plan = 0;
      let fact = 0;
      for (const d of docs) {
        plan += (progressPercentAt(d.planned, t) / 100) * d.weight;
        fact += (progressPercentAt(d.actual, t) / 100) * d.weight;
      }
      return {
        date: iso,
        plan: Math.round(plan * 100) / 100,
        fact: Math.round(fact * 100) / 100,
      };
    });
  }, [docs]);

  const totalWeight = useMemo(() => docs.reduce((acc, d) => acc + d.weight, 0), [docs]);
  const todayIso = toIso(new Date());
  // Точка «сегодня»: либо точная, либо последняя ≤ сегодня.
  const currentPoint = useMemo(() => {
    if (!curve.length) return null;
    const exact = curve.find((p) => p.date === todayIso);
    if (exact) return exact;
    const earlier = [...curve].reverse().find((p) => p.date <= todayIso);
    return earlier ?? curve[0];
  }, [curve, todayIso]);
  const planNow = currentPoint?.plan ?? 0;
  const factNow = currentPoint?.fact ?? 0;

  return (
    <div className="reporting-module">
      <Space style={{ marginBottom: 12, justifyContent: "space-between", width: "100%" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Отчётность
        </Typography.Title>
        <Select
          style={{ minWidth: 280 }}
          value={projectCode}
          onChange={setProjectCode}
          options={projects.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))}
          placeholder="Проект"
        />
      </Space>

      <Space size={12} style={{ width: "100%", marginBottom: 12 }} wrap>
        <Card size="small" style={{ minWidth: 150 }} className="dashboard-stat-card">
          <Statistic title="Документов" value={docs.length} />
        </Card>
        <Card size="small" style={{ minWidth: 150 }} className="dashboard-stat-card">
          <Statistic title="Общий вес" value={Math.round(totalWeight)} />
        </Card>
        <Card size="small" style={{ minWidth: 150 }} className="dashboard-stat-card">
          <Statistic title="План на сегодня" value={Math.round(planNow)} valueStyle={{ color: "#1677ff" }} />
        </Card>
        <Card size="small" style={{ minWidth: 150 }} className="dashboard-stat-card">
          <Statistic title="Факт на сегодня" value={Math.round(factNow)} valueStyle={{ color: "#52c41a" }} />
        </Card>
      </Space>

      <Card title="S-кривая прогресса проекта (план / факт)" loading={loading}>
        {curve.length === 0 ? (
          <Empty description="Нет данных. Выберите проект с документами в работе." />
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={curve} margin={{ top: 10, right: 24, bottom: 24, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => formatDateRu(new Date(v))}
                tick={{ fontSize: 11, fill: "#737373" }}
                tickMargin={8}
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#737373" }}
                tickMargin={4}
                width={60}
                label={{ value: "Прогресс (ед. веса)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#737373" } }}
              />
              <Tooltip
                formatter={(value) => String(Math.round(Number(value)))}
                labelFormatter={(v) => formatDateRu(new Date(String(v)))}
                contentStyle={{ borderRadius: 8, border: "1px solid #e8e8e8", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine
                x={todayIso}
                stroke="#a3a3a3"
                strokeDasharray="4 4"
                label={{ value: "сегодня", fontSize: 11, fill: "#737373", position: "top" }}
              />
              <Line
                type="monotone"
                dataKey="plan"
                name="План"
                stroke="#1677ff"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="fact"
                name="Факт"
                stroke="#52c41a"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        Этапы прогресса (фиксированные веса):
        {" "}
        {STAGES.map((s, i) => (
          <span key={s.weight}>
            {i > 0 ? " · " : ""}
            <b>{s.weight}%</b> {s.title}
          </span>
        ))}
      </Typography.Paragraph>
    </div>
  );
}
