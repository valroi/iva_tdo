import { Card, Empty, Select, Space, Table, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

import { getAdminReviewSlaSettings, listDocumentsRegistry, listProjectReferences } from "../api";
import type { DocumentRegistryItem, MDRRecord, ProjectItem } from "../types";
import { formatDateTimeRu } from "../utils/datetime";

interface Props {
  projects: ProjectItem[];
  mdr: MDRRecord[];
}

const DEFAULT_PLANNED_DURATION_DAYS = 14;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIsoDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function formatDateRu(value: Date | null): string {
  if (!value) return "—";
  const dd = String(value.getDate()).padStart(2, "0");
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const yyyy = String(value.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

function addDays(date: Date | null, days: number): Date | null {
  if (!date) return null;
  const dt = new Date(date);
  dt.setDate(dt.getDate() + days);
  return dt;
}

function diffDays(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

function statusProgress(status: string): number {
  const map: Record<string, number> = {
    REVISION_CREATED: 0.2,
    UPLOADED_WAITING_TDO: 0.4,
    CANCELLED_BY_TDO: 0.3,
    UNDER_REVIEW: 0.6,
    OWNER_COMMENTS_SENT: 0.75,
    CONTRACTOR_REPLY_I: 0.8,
    CONTRACTOR_REPLY_A: 0.9,
    SUBMITTED: 1,
  };
  return map[status] ?? 0;
}

export default function ReportingPage({ projects, mdr }: Props): JSX.Element {
  const [projectCode, setProjectCode] = useState<string | null>(projects[0]?.code ?? null);
  const [rows, setRows] = useState<DocumentRegistryItem[]>([]);
  const [slaByCode, setSlaByCode] = useState<Map<string, number>>(new Map());
  const [adminSla, setAdminSla] = useState<{
    owner_specialist_review_days: number;
    contractor_consideration_days: number;
    contractor_ap_issue_days: number;
    contractor_an_issue_days: number;
    contractor_co_rj_issue_days: number;
    owner_final_approval_days: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projects.length) {
      setProjectCode(null);
      return;
    }
    if (!projectCode || !projects.some((item) => item.code === projectCode)) {
      setProjectCode(projects[0].code);
    }
  }, [projectCode, projects]);

  useEffect(() => {
    if (!projectCode) {
      setRows([]);
      return;
    }
    setLoading(true);
    void listDocumentsRegistry({ project_code: projectCode })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [projectCode]);

  useEffect(() => {
    void getAdminReviewSlaSettings()
      .then((settings) =>
        setAdminSla({
          owner_specialist_review_days: settings.owner_specialist_review_days,
          contractor_consideration_days: settings.contractor_consideration_days,
          contractor_ap_issue_days: settings.contractor_ap_issue_days,
          contractor_an_issue_days: settings.contractor_an_issue_days,
          contractor_co_rj_issue_days: settings.contractor_co_rj_issue_days,
          owner_final_approval_days: settings.owner_final_approval_days,
        }),
      )
      .catch(() => setAdminSla(null));
  }, []);

  useEffect(() => {
    const selectedProject = projects.find((item) => item.code === projectCode);
    if (!selectedProject) {
      setSlaByCode(new Map());
      return;
    }
    void listProjectReferences(selectedProject.id, "review_sla_days")
      .then((refs) => {
        const parsed = new Map<string, number>();
        refs.forEach((ref) => {
          const num = Number(ref.value);
          if (ref.is_active && Number.isFinite(num) && num > 0) {
            parsed.set(ref.code.toUpperCase(), num);
          }
        });
        setSlaByCode(parsed);
      })
      .catch(() => setSlaByCode(new Map()));
  }, [projectCode, projects]);

  const mdrByDocNum = useMemo(() => new Map(mdr.map((item) => [item.doc_number, item])), [mdr]);

  const resolvePlannedDurationDays = useMemo(() => {
    return (row: DocumentRegistryItem): number => {
      const issue = (row.latest_issue_purpose ?? "").toUpperCase();
      const category = (row.category ?? "*").toUpperCase();
      const phase = row.revisions.length <= 1 ? "INITIAL" : "NEXT";
      const candidates = [
        `${category}:${issue}:${phase}`,
        `*:${issue}:${phase}`,
        `${category}:*:${phase}`,
        `*:*:${phase}`,
      ];
      for (const key of candidates) {
        const value = slaByCode.get(key);
        if (value && value > 0) return value;
      }

      // Fallback by release purpose when project SLA refs are not configured.
      if (phase === "INITIAL") {
        if (issue === "IFA" || issue === "IFR") return 20;
        return 14;
      }
      if (issue === "IFA" || issue === "IFR") return 7;
      return DEFAULT_PLANNED_DURATION_DAYS;
    };
  }, [slaByCode]);

  const progressRows = useMemo(() => {
    return rows.map((item) => {
      const mdrRow = mdrByDocNum.get(item.document_num);
      const plannedStartDate = toDate(item.planned_dev_start ?? mdrRow?.planned_dev_start ?? null);
      const plannedDurationDays = resolvePlannedDurationDays(item);
      const plannedFinishDate = addDays(plannedStartDate, plannedDurationDays);
      const actualStartDate = toDate(item.first_upload_date);
      const revisions = [...item.revisions].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const latestRevision = revisions[revisions.length - 1];
      const latestRevisionDate = toDate(latestRevision?.created_at ?? null);
      const actualNow = statusProgress(latestRevision?.status ?? "");
      const actualFinishDate = actualNow >= 1 ? latestRevisionDate : null;
      const ownerReviewCycles = revisions.filter((rev) => rev.review_code && rev.review_code !== "AP").length;
      const latestOwnerReviewCode = [...revisions].reverse().find((rev) => rev.review_code)?.review_code ?? null;
      const ownerReviewDays = adminSla?.owner_specialist_review_days ?? 8;
      const contractorFixDaysByCode =
        latestOwnerReviewCode === "AN"
          ? adminSla?.contractor_an_issue_days ?? 5
          : latestOwnerReviewCode === "CO" || latestOwnerReviewCode === "RJ"
            ? adminSla?.contractor_co_rj_issue_days ?? 8
            : adminSla?.contractor_ap_issue_days ?? 2;
      const plannedDurationByProcedure =
        plannedDurationDays +
        ownerReviewDays +
        ownerReviewCycles * (contractorFixDaysByCode + ownerReviewDays) +
        (latestOwnerReviewCode === "AP" ? adminSla?.owner_final_approval_days ?? 2 : 0);

      const durationDays =
        plannedStartDate && plannedFinishDate
          ? Math.max(1, diffDays(plannedStartDate, plannedFinishDate))
          : plannedDurationByProcedure;
      let forecastFinishDate: Date | null = null;
      if (actualNow >= 1) {
        forecastFinishDate = actualFinishDate;
      } else if (actualNow <= 0) {
        forecastFinishDate = addDays(plannedStartDate, plannedDurationByProcedure);
      } else {
        const anchor = latestRevisionDate ?? actualStartDate ?? new Date();
        if (latestRevision?.status === "CONTRACTOR_REPLY_I") {
          forecastFinishDate = addDays(anchor, adminSla?.contractor_consideration_days ?? 2);
        } else if (latestRevision?.status === "OWNER_COMMENTS_SENT") {
          forecastFinishDate = addDays(anchor, contractorFixDaysByCode + ownerReviewDays);
        } else if (latestRevision?.status === "UNDER_REVIEW") {
          forecastFinishDate = addDays(anchor, ownerReviewDays + contractorFixDaysByCode + ownerReviewDays);
        } else {
          const remaining = 1 - actualNow;
          const forecastDays = Math.max(1, Math.round((remaining * durationDays) / Math.max(actualNow, 0.05)));
          forecastFinishDate = addDays(anchor, forecastDays);
        }
      }

      const today = new Date();
      const plannedNow =
        plannedStartDate && plannedFinishDate
          ? smoothstep01(diffDays(plannedStartDate, today) / Math.max(1, diffDays(plannedStartDate, plannedFinishDate)))
          : 0;

      return {
        key: item.document_id,
        document_num: item.document_num,
        document_title: item.document_title,
        weight: Number(mdrRow?.doc_weight ?? 0),
        issuePurpose: item.latest_issue_purpose ?? "—",
        latestOwnerReviewCode,
        ownerReviewCycles,
        plannedDurationDays: plannedDurationByProcedure,
        plannedStartDate,
        plannedFinishDate,
        actualStartDate,
        actualFinishDate,
        latestRevisionDate,
        revisions,
        plannedNow,
        actualNow,
        forecastFinishDate,
      };
    });
  }, [adminSla, mdrByDocNum, resolvePlannedDurationDays, rows]);

  const hasPositiveWeights = useMemo(() => progressRows.some((row) => row.weight > 0), [progressRows]);
  const totalWeight = useMemo(
    () =>
      progressRows.reduce((acc, row) => {
        if (hasPositiveWeights) return acc + Math.max(0, row.weight);
        return acc + 1;
      }, 0),
    [hasPositiveWeights, progressRows],
  );

  const currentTotals = useMemo(() => {
    if (!progressRows.length || totalWeight <= 0) return { planned: 0, actual: 0 };
    const weighted = progressRows.reduce(
      (acc, row) => {
        const w = hasPositiveWeights ? Math.max(0, row.weight) : 1;
        acc.planned += row.plannedNow * w;
        acc.actual += row.actualNow * w;
        return acc;
      },
      { planned: 0, actual: 0 },
    );
    return {
      planned: (weighted.planned / totalWeight) * 100,
      actual: (weighted.actual / totalWeight) * 100,
    };
  }, [hasPositiveWeights, progressRows, totalWeight]);

  const curvePoints = useMemo(() => {
    if (!progressRows.length || totalWeight <= 0) return [];
    const today = new Date();
    const dateSet = new Set<string>([toIsoDate(today) ?? ""]);
    progressRows.forEach((row) => {
      [row.plannedStartDate, row.plannedFinishDate, row.actualStartDate, row.actualFinishDate, row.forecastFinishDate, row.latestRevisionDate].forEach(
        (dt) => {
          const key = toIsoDate(dt);
          if (key) dateSet.add(key);
        },
      );
      row.revisions.forEach((revision) => {
        const key = toIsoDate(toDate(revision.created_at));
        if (key) dateSet.add(key);
      });
    });
    const sortedDates = [...dateSet].filter(Boolean).sort();

    return sortedDates.map((dateIso) => {
      const currentDate = toDate(dateIso)!;
      let planned = 0;
      let actual = 0;
      let forecast = 0;
      for (const row of progressRows) {
        const w = hasPositiveWeights ? Math.max(0, row.weight) : 1;

        let plannedFraction = 0;
        if (row.plannedStartDate && row.plannedFinishDate) {
          const full = Math.max(1, diffDays(row.plannedStartDate, row.plannedFinishDate));
          plannedFraction = clamp01(diffDays(row.plannedStartDate, currentDate) / full);
        }

        const latestUntilDate = row.revisions
          .filter((revision) => {
            const revisionDate = toDate(revision.created_at);
            return revisionDate ? revisionDate.getTime() <= currentDate.getTime() : false;
          })
          .at(-1);
        const actualFraction = statusProgress(latestUntilDate?.status ?? "");

        let forecastFraction = actualFraction;
        if (currentDate.getTime() > today.getTime() && row.forecastFinishDate) {
          const startProgress = row.actualNow;
          const startDate = row.latestRevisionDate ?? today;
          if (currentDate.getTime() >= row.forecastFinishDate.getTime()) {
            forecastFraction = 1;
          } else {
            const full = Math.max(1, diffDays(startDate, row.forecastFinishDate));
            const part = clamp01(diffDays(startDate, currentDate) / full);
            forecastFraction = clamp01(startProgress + (1 - startProgress) * smoothstep01(part));
          }
        }

        planned += plannedFraction * w;
        actual += actualFraction * w;
        forecast += forecastFraction * w;
      }

      return {
        date: dateIso,
        planned: (planned / totalWeight) * 100,
        actual: (actual / totalWeight) * 100,
        forecast: (forecast / totalWeight) * 100,
      };
    });
  }, [hasPositiveWeights, progressRows, totalWeight]);

  if (!projectCode) {
    return <Empty description="Выберите проект" />;
  }

  return (
    <Card title="Отчетность: план/факт и S-кривая">
      <Space style={{ marginBottom: 12 }}>
        <Typography.Text>Проект:</Typography.Text>
        <Select
          style={{ minWidth: 300 }}
          value={projectCode ?? undefined}
          options={projects.map((item) => ({ value: item.code, label: `${item.code} - ${item.name}` }))}
          onChange={(value) => setProjectCode(value)}
        />
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 8 }}>
        Логика 3.0: накопление идет по весам `doc_weight` из MDR. В цикле 85% учитываются повторные итерации замечаний
        (AN/CO/RJ) до достижения AP. Факт - по workflow, прогноз - от текущего факта по SLA-ветке статуса.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Длительность плана берется из справочника проекта `review_sla_days` (маска `CATEGORY:ISSUE_PURPOSE:INITIAL|NEXT`), при отсутствии - fallback.
      </Typography.Paragraph>
      <Typography.Text strong>
        Текущий прогресс проекта: план {currentTotals.planned.toFixed(1)}% / факт {currentTotals.actual.toFixed(1)}%
      </Typography.Text>
      {curvePoints.length === 0 ? (
        <Empty description="Недостаточно данных для построения S-кривой" />
      ) : (
        <svg width="100%" height="200" viewBox="0 0 800 200">
          <polyline
            fill="none"
            stroke="#1677ff"
            strokeWidth="3"
            points={curvePoints
              .map((point, index) => `${(index / Math.max(1, curvePoints.length - 1)) * 760 + 20},${180 - (point.planned / 100) * 160}`)
              .join(" ")}
          />
          <polyline
            fill="none"
            stroke="#52c41a"
            strokeWidth="3"
            points={curvePoints
              .map((point, index) => `${(index / Math.max(1, curvePoints.length - 1)) * 760 + 20},${180 - (point.actual / 100) * 160}`)
              .join(" ")}
          />
          <polyline
            fill="none"
            stroke="#faad14"
            strokeWidth="3"
            points={curvePoints
              .map((point, index) => `${(index / Math.max(1, curvePoints.length - 1)) * 760 + 20},${180 - (point.forecast / 100) * 160}`)
              .join(" ")}
          />
        </svg>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Синяя линия - план, зеленая - факт, желтая - прогноз.
      </Typography.Paragraph>
      <Table
        rowKey="key"
        loading={loading}
        size="small"
        dataSource={progressRows}
        pagination={false}
        scroll={{ x: "max-content" }}
        columns={[
          { title: "Документ", dataIndex: "document_num" },
          { title: "Название", dataIndex: "document_title" },
          { title: "Цель", dataIndex: "issuePurpose" },
          { title: "Код заказчика", dataIndex: "latestOwnerReviewCode", render: (v: string | null) => v ?? "—" },
          { title: "Циклы 85%", dataIndex: "ownerReviewCycles" },
          { title: "Вес", dataIndex: "weight", render: (v: number) => String(Math.round(v)) },
          { title: "План, дн", dataIndex: "plannedDurationDays" },
          { title: "План старт", dataIndex: "plannedStartDate", render: (v: Date | null) => formatDateRu(v) },
          { title: "План финиш", dataIndex: "plannedFinishDate", render: (v: Date | null) => formatDateRu(v) },
          { title: "Факт старт", dataIndex: "actualStartDate", render: (v: Date | null) => formatDateRu(v) },
          { title: "Факт финиш", dataIndex: "actualFinishDate", render: (v: Date | null) => formatDateRu(v) },
          { title: "Прогноз финиша", dataIndex: "forecastFinishDate", render: (v: Date | null) => formatDateRu(v) },
          { title: "План %", dataIndex: "plannedNow", render: (v: number) => (v * 100).toFixed(1) },
          { title: "Факт %", dataIndex: "actualNow", render: (v: number) => (v * 100).toFixed(1) },
        ]}
      />
    </Card>
  );
}
