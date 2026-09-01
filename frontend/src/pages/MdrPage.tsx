import { paginationProps } from "../utils/pagination";
import { Alert, AutoComplete, Button, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import { DownOutlined, FileExcelOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  checkMdrCipher,
  composeMdrCipher,
  createChildMdr,
  createDocument,
  createMdr,
  downloadMdrTemplate,
  exportMdr,
  deleteMdr,
  importMdr,
  updateMdr,
} from "../api";
import type { CipherTemplateField, MDRRecord, ProjectItem, ProjectReference, ReviewMatrixMember, User } from "../types";
import { formatDateRu } from "../utils/datetime";

// Фильтр из дерева структуры проекта: тот же тип, что у «Ревизий и
// комментариев», чтобы клик по узлу одинаково сужал обе вкладки.
export type MdrTreeFilter =
  | { kind: "category"; value: string }
  | { kind: "document"; mdrId: number }
  | null;

interface Props {
  mdr: MDRRecord[];
  projects: ProjectItem[];
  currentUser: User;
  projectReferences: ProjectReference[];
  onCreated: () => Promise<void>;
  onOpenDocument?: (documentNum: string) => void;
  treeFilter?: MdrTreeFilter;
  onResetTreeFilter?: () => void;
  reviewMatrix?: ReviewMatrixMember[];
}

/** «1 вложенный документ» / «2 вложенных документа» / «5 вложенных документов». */
function pluralNested(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "вложенных документов";
  if (mod10 === 1) return "вложенный документ";
  if (mod10 >= 2 && mod10 <= 4) return "вложенных документа";
  return "вложенных документов";
}

export default function MdrPage({
  mdr,
  projects,
  currentUser,
  projectReferences,
  onCreated,
  onOpenDocument,
  treeFilter,
  onResetTreeFilter,
  reviewMatrix = [],
}: Props): JSX.Element {
  const canManageMdr = currentUser.role === "admin" || currentUser.permissions.can_create_mdr;
  const isAdmin = currentUser.role === "admin";
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serialAutoMode, setSerialAutoMode] = useState(true);
  const [docNumberExists, setDocNumberExists] = useState<boolean | null>(null);
  const [cipherTemplateFields, setCipherTemplateFields] = useState<CipherTemplateField[]>([]);
  const [importingMdr, setImportingMdr] = useState(false);
  const [editingMdrId, setEditingMdrId] = useState<number | null>(null);
  const [editingOriginalDocNumber, setEditingOriginalDocNumber] = useState<string | null>(null);
  const [editingHistoryLines, setEditingHistoryLines] = useState<string[]>([]);
  const [deletingMdrId, setDeletingMdrId] = useState<number | null>(null);
  const [deletingMdrLoading, setDeletingMdrLoading] = useState(false);
  // Вложенные сносятся каскадом вместе с родителем (решение 2026-08-31),
  // поэтому в подтверждении показываем, сколько документов уедет заодно.
  const deletingChildCount = useMemo(
    () => (deletingMdrId === null ? 0 : mdr.filter((row) => row.parent_id === deletingMdrId).length),
    [mdr, deletingMdrId],
  );
  const [childParent, setChildParent] = useState<MDRRecord | null>(null);
  const [childSubmitting, setChildSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  // Реестр сужается двумя способами: клик по узлу дерева (документ + его
  // вложенные, либо вся категория) и строка поиска по шифру/названию.
  // Полотно на 30+ документов иначе нечитаемо.
  const visibleMdr = useMemo(() => {
    let rows = mdr;
    if (treeFilter?.kind === "category") {
      rows = rows.filter((row) => (row.category || "").toUpperCase() === treeFilter.value.toUpperCase());
    } else if (treeFilter?.kind === "document") {
      rows = rows.filter((row) => row.id === treeFilter.mdrId || row.parent_id === treeFilter.mdrId);
    }
    const query = search.trim().toLowerCase();
    if (query) {
      rows = rows.filter(
        (row) =>
          (row.doc_number || "").toLowerCase().includes(query) ||
          (row.doc_name || "").toLowerCase().includes(query),
      );
    }
    return rows;
  }, [mdr, treeFilter, search]);
  const treeFilterLabel = useMemo(() => {
    if (treeFilter?.kind === "category") return `категория ${treeFilter.value}`;
    if (treeFilter?.kind === "document") {
      const target = mdr.find((row) => row.id === treeFilter.mdrId);
      return target ? `${target.doc_number} и вложенные` : "выбранный документ";
    }
    return null;
  }, [treeFilter, mdr]);
  const [childForm] = Form.useForm();
  const normalizePdCipher = (value: string): string => {
    const raw = String(value || "").trim().toUpperCase();
    // Схема со сжатым разделом/книгой — только у PD. У SE и остальных
    // категорий шифр плоский (7 сегментов через дефис), сжимать нечего.
    const rx = /^([A-Z]{3})-([A-Z]{3})-(PD)-(\d{4})-([A-Z0-9]{2,8})-(\d{1,2})(?:-)?([0-9.]{1,5})?$/;
    const match = rx.exec(raw);
    if (!match) return raw;
    const [, projectCode, originatorCode, cat, title, section, part, book] = match;
    return `${projectCode}-${originatorCode}-${cat}-${title}-${section}${part}${book ? `.${book}` : ""}`;
  };
  const childTitleObject = Form.useWatch("title_object", childForm);
  const childSerial = Form.useWatch("serial", childForm);
  const childDiscipline = Form.useWatch("discipline_code", childForm);
  const childDocType = Form.useWatch("doc_type", childForm);
  // Справочник разделов зависит от категории РОДИТЕЛЯ (у вложенного она своя
  // не бывает): PD — разделы ПД, SE — виды отчётов, остальное — дисциплины.
  const childDisciplineOptions = useMemo(() => {
    const category = String(childParent?.category || "").toUpperCase();
    const wanted = category === "PD" ? "pd_section" : category === "SE" ? "se_reporting_type" : "discipline";
    return projectReferences
      .filter((ref) => ref.ref_type === wanted && ref.is_active)
      .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` }));
  }, [projectReferences, childParent?.category]);
  // Показываем итоговый шифр до создания: со своим титулом собирается полная
  // маска категории, без него — старая схема «шифр родителя + -NN».
  const childCipherPreview = useMemo(() => {
    if (!childParent) return "…";
    const parentTitle = String(childParent.title_object ?? "").trim().toUpperCase();
    const parentDiscipline = String(childParent.discipline_code ?? "").trim().toUpperCase();
    const parentDocType = String(childParent.doc_type ?? "").trim().toUpperCase();
    const title = String(childTitleObject ?? "").trim().toUpperCase() || parentTitle;
    const discipline = String(childDiscipline ?? "").trim().toUpperCase() || parentDiscipline;
    const docType = String(childDocType ?? "").trim().toUpperCase() || parentDocType;
    const serial = String(childSerial ?? "").trim().toUpperCase();
    if (title !== parentTitle || discipline !== parentDiscipline || docType !== parentDocType) {
      // Через normalizePdCipher: у PD раздел/часть/книга склеиваются (AR33.2),
      // у остальных категорий шифр остаётся плоским. Так же собирает бэкенд.
      return normalizePdCipher(
        [
          childParent.project_code,
          childParent.originator_code,
          childParent.category,
          title,
          discipline,
          docType,
          serial || childParent.serial_number,
        ]
          .join("-")
          .toUpperCase(),
      );
    }
    return `${childParent.doc_number}-${serial || "NN"}`;
  }, [childParent, childTitleObject, childSerial, childDiscipline, childDocType]);

  const [form] = Form.useForm();
  const latestComposeRequestRef = useRef(0);
  // Скрытые input'ы для импорта Excel — Dropdown триггерит их клик.
  const importCheckRef = useRef<HTMLInputElement | null>(null);
  const importApplyRef = useRef<HTMLInputElement | null>(null);

  const currentProjectCode = Form.useWatch("project_code", form);
  const currentDocType = Form.useWatch("doc_type", form);
  const currentCategory = Form.useWatch("category", form);
  const currentDisciplineCode = Form.useWatch("discipline_code", form);
  const currentOriginatorCode = Form.useWatch("originator_code", form);
  const currentTitleObject = Form.useWatch("title_object", form);
  const currentSerialNumber = Form.useWatch("serial_number", form);
  const allFormValues = Form.useWatch([], form) as Record<string, unknown> | undefined;
  const isSingleProject = projects.length === 1;
  const defaultProjectCode = projects[0]?.code;
  const selectedProject = useMemo(
    () => projects.find((project) => project.code === currentProjectCode) ?? null,
    [projects, currentProjectCode],
  );
  const defaultOriginator = (currentUser.company_code || (currentUser.company_type === "contractor" ? "CTR" : currentUser.company_type === "owner" ? "OWN" : "ADM"))
    .toUpperCase()
    .slice(0, 3);

  const categoryOptions = useMemo(() => {
    const active = projectReferences
      .filter((ref) => ref.ref_type === "document_category" && ref.is_active)
      .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` }));
    if (selectedProject?.document_category) {
      // Категория проекта — первой; остальные активные категории справочника
      // (например SE — инженерные изыскания) доступны дополнительно.
      const primary = selectedProject.document_category;
      const byCode = projectReferences.find(
        (ref) => ref.ref_type === "document_category" && ref.code === primary,
      );
      const first = { value: primary, label: byCode ? `${primary} - ${byCode.value}` : primary };
      return [first, ...active.filter((o) => o.value !== primary)];
    }
    return active;
  }, [projectReferences, selectedProject?.document_category]);
  const isPdCategory = String(currentCategory || "").toUpperCase() === "PD";
  const isSeCategory = String(currentCategory || "").toUpperCase() === "SE";
  const disciplineOptions = useMemo(() => {
    // PD — раздел ПД (pd_section); SE (инженерные изыскания) — вид отчёта
    // из справочника «SE отчеты» (se_reporting_type); остальные категории
    // (шифр без сжатия: IMP-CTR-CAT-1001-ДИСЦ-ТИП-001) — общий справочник
    // «Дисциплина» (discipline).
    const wantedTypes = isPdCategory ? ["pd_section"] : isSeCategory ? ["se_reporting_type"] : ["discipline"];
    return projectReferences
      .filter((ref) => wantedTypes.includes(ref.ref_type) && ref.is_active)
      .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` }));
  }, [projectReferences, isPdCategory, isSeCategory]);
  const documentTypeOptions = useMemo(
    () =>
      projectReferences
        .filter((ref) => ref.ref_type === "document_type" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [projectReferences],
  );
  const titleObjectOptions = useMemo(
    () =>
      projectReferences
        .filter((ref) => ref.ref_type === "title_object" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [projectReferences],
  );
  const pdSectionNumberByCode = useMemo(() => {
    return new Map<string, string>([
      ["PZ", "1"],
      ["PZU", "2"],
      ["AR", "3"],
      ["KR", "4"],
      ["IOS", "5"],
      ["TR", "6"],
      ["POS", "7"],
      ["OOS", "8"],
      ["PB", "9"],
      ["TBE", "10"],
      ["ODI", "11"],
      ["SM", "12"],
    ]);
  }, []);
  // Подсказка до нажатия «Создать»: бэкенд всё равно не даст завести документ
  // без LR по разделу (services/matrix_gap), но подрядчик должен понимать это
  // сразу, а не после ошибки. Для SE матрица ведётся одним условным разделом.
  const matrixDisciplineKey = String(currentDisciplineCode || "").toUpperCase();
  const hasLeadReviewer = useMemo(() => {
    if (!matrixDisciplineKey) return true;
    const category = String(currentCategory || "").toUpperCase();
    // Те же правила, что в _matrix_match_clause на бэке: строка без категории
    // покрывает любую, а раздел «SE» в категории SE — все виды отчётов.
    return reviewMatrix.some((row) => {
      if (row.level !== 1 || row.state !== "LR") return false;
      const rowCategory = String(row.category ?? "").toUpperCase();
      if (rowCategory && rowCategory !== category) return false;
      const rowSection = String(row.discipline_code || "").toUpperCase();
      return rowSection === matrixDisciplineKey || (category === "SE" && rowSection === "SE");
    });
  }, [reviewMatrix, matrixDisciplineKey, currentCategory]);
  const missingReviewerNotice =
    !isAdmin && matrixDisciplineKey && !hasLeadReviewer ? matrixDisciplineKey : null;
  const currentSectionNumber = (pdSectionNumberByCode.get(String(currentDisciplineCode || "").toUpperCase()) ?? "—");
  const categoryWeight = useMemo(() => {
    if (!currentProjectCode || !currentCategory) return 0;
    // При редактировании собственный вес документа исключается — иначе он
    // учитывается дважды и форма ложно кричит «лимит превышен».
    return mdr
      .filter(
        (row) =>
          row.project_code === currentProjectCode &&
          row.category === currentCategory &&
          row.id !== editingMdrId,
      )
      .reduce((acc, row) => acc + (row.doc_weight ?? 0), 0);
  }, [currentCategory, currentProjectCode, mdr, editingMdrId]);

  const columns: ColumnsType<MDRRecord> = [
    {
      title: "Шифр",
      dataIndex: "doc_number",
      key: "doc_number",
      width: 280,
      render: (value: string, row: MDRRecord) => (
        <Space direction="vertical" size={2} style={{ paddingLeft: row.parent_id ? 16 : 0, maxWidth: 260 }}>
          <Space size={4} style={{ width: "100%" }}>
            {row.parent_id ? <Typography.Text type="secondary">↳</Typography.Text> : null}
            <Button
              type="link"
              style={{ padding: 0 }}
              onClick={() => onOpenDocument?.(normalizePdCipher(value))}
            >
              <Typography.Text
                ellipsis={{ tooltip: normalizePdCipher(value) }}
                style={{ whiteSpace: "nowrap", display: "inline-block", maxWidth: 230 }}
              >
                {normalizePdCipher(value)}
              </Typography.Text>
            </Button>
          </Space>
          {row.parent_id ? <Tag color="geekblue" style={{ margin: 0 }}>вложенный</Tag> : null}
        </Space>
      ),
    },
    { title: "Проект", dataIndex: "project_code", key: "project_code" },
    {
      title: "Название",
      dataIndex: "doc_name",
      key: "doc_name",
      width: 300,
      ellipsis: true,
      render: (value: string) => (
        <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 280, whiteSpace: "nowrap", display: "inline-block" }}>
          {value}
        </Typography.Text>
      ),
    },
    { title: "Дисциплина", dataIndex: "discipline_code", key: "discipline_code" },
    {
      title: "План выпуска ревизии A",
      dataIndex: "planned_dev_start",
      key: "planned_dev_start",
      render: (value: string | null | undefined) => formatDateRu(value),
    },
    {
      title: "Код замечаний",
      key: "review_code",
      render: (_: unknown, row: MDRRecord) => {
        const code = row.latest_effective_review_code ?? row.review_code;
        if (!code) return "—";
        const color = code === "AP" ? "green" : code === "AN" ? "blue" : code === "CO" ? "orange" : code === "RJ" ? "red" : "default";
        return <Tag color={color}>{code}</Tag>;
      },
    },
    { title: "Вес", dataIndex: "doc_weight", key: "doc_weight" },
    ...(canManageMdr
      ? [
          {
            title: "Действие",
            key: "action",
            width: 320,
            render: (_: unknown, row: MDRRecord) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    // Полный сброс перед заполнением: остатки прошлого
                    // открытия (категория, шифр) не должны протекать сюда.
                    form.resetFields();
                    // В редактировании номер не пересчитывается автоматом —
                    // показываем фактический номер документа как есть.
                    setSerialAutoMode(false);
                    form.setFieldsValue({
                      ...row,
                      category: row.category,
                    });
                    setEditingMdrId(row.id);
                    setEditingOriginalDocNumber(row.doc_number);
                    const historyRaw = Array.isArray((row.dates as { update_history?: unknown[] } | undefined)?.update_history)
                      ? ((row.dates as { update_history?: unknown[] }).update_history as unknown[])
                      : [];
                    const lines = historyRaw
                      .slice(-5)
                      .map((item) => {
                        const entry = item as { updated_at?: string; updated_by?: string; changed_fields?: Record<string, unknown> };
                        const fields = Object.keys(entry.changed_fields ?? {});
                        return `${entry.updated_at ?? "n/a"} · ${entry.updated_by ?? "unknown"} · ${fields.join(", ") || "no fields"}`;
                      })
                      .reverse();
                    setEditingHistoryLines(lines);
                    setOpen(true);
                  }}
                >
                  Открыть / Ред.
                </Button>
                {/* Вложенный документ (напр. программа изысканий) — только под
                    документом верхнего уровня, не под другим вложенным. */}
                {!row.parent_id && (
                  <Button
                    size="small"
                    onClick={() => {
                      childForm.resetFields();
                      setChildParent(row);
                    }}
                  >
                    + Вложенный
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    size="small"
                    danger
                    onClick={() => setDeletingMdrId(row.id)}
                  >
                    Удалить
                  </Button>
                )}
              </Space>
            ),
          } as ColumnsType<MDRRecord>[number],
        ]
      : []),
  ];

  const nextDocumentKey = useMemo(() => {
    const maxIdx = mdr.reduce((max, item) => {
      const match = /^DOC-(\d+)$/i.exec(item.document_key ?? "");
      const value = match ? Number(match[1]) : 0;
      return Math.max(max, value);
    }, 0);
    return `DOC-${String(maxIdx + 1).padStart(4, "0")}`;
  }, [mdr]);

  const submit = async () => {
    if (!canManageMdr) {
      message.error("Недостаточно прав для создания документа");
      return;
    }
    // validateFields бросает исключение — раньше оно улетало «в никуда», и по
    // кнопке ОК просто ничего не происходило. Теперь показываем, какое поле
    // мешает, и подкручиваем форму к нему.
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch (error) {
      const failed = (error as { errorFields?: { name: (string | number)[]; errors: string[] }[] })?.errorFields ?? [];
      if (failed.length > 0) {
        form.scrollToField(failed[0].name, { behavior: "smooth", block: "center" });
        message.error(`Заполните обязательные поля: ${failed.map((item) => item.errors[0]).join("; ")}`);
      } else {
        message.error("Проверьте заполнение формы");
      }
      return;
    }
    const unchangedCipherInEdit =
      Boolean(editingMdrId) && normalizePdCipher(values.doc_number) === normalizePdCipher(editingOriginalDocNumber ?? "");
    if (docNumberExists && !unchangedCipherInEdit) {
      message.error("Нельзя сохранить: шифр уже существует в проекте");
      return;
    }
    if ((values.doc_weight ?? 0) + categoryWeight > 1000) {
      message.error(`Превышен лимит веса для категории: ${(values.doc_weight ?? 0) + categoryWeight} / 1000`);
      return;
    }

    setSubmitting(true);
    try {
      const normalizedDocNumber = normalizePdCipher(values.doc_number);
      if (editingMdrId) {
        await updateMdr(editingMdrId, {
          ...values,
          doc_number: normalizedDocNumber,
          originator_code: (values.originator_code as string).toUpperCase().slice(0, 3),
        });
      } else {
        const created = await createMdr({
          ...values,
          doc_number: normalizedDocNumber,
          originator_code: (values.originator_code as string).toUpperCase().slice(0, 3),
          progress_percent: 0,
          dates: {},
          status: "DRAFT",
          is_confidential: false,
        });
        await createDocument({
          mdr_id: created.id,
          document_num: normalizedDocNumber,
          title: values.doc_name,
          discipline: values.discipline_code,
          weight: values.doc_weight ?? 0,
        });
      }
      form.resetFields();
      setOpen(false);
      setEditingMdrId(null);
      setEditingOriginalDocNumber(null);
      setEditingHistoryLines([]);
      await onCreated();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка создания документа";
      message.error(text);
    } finally {
      setSubmitting(false);
    }
  };

  const composeCipher = async () => {
    const values = form.getFieldsValue([
      "project_code",
      "originator_code",
      "category",
      "title_object",
      "discipline_code",
      "doc_type",
      "serial_number",
    ]);
    const allValues = form.getFieldsValue(true) as Record<string, string | number | undefined>;
    const valuesMap: Record<string, string> = {};
    Object.entries(allValues).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      valuesMap[key] = String(value);
    });

    const hasTemplate = cipherTemplateFields.length > 0;
    if (hasTemplate) {
      const missingTemplateRequired = cipherTemplateFields.some(
        (field) =>
          field.required &&
          field.source_type !== "STATIC" &&
          field.source_type !== "AUTO_SERIAL" &&
          !String(valuesMap[field.field_key] ?? "").trim(),
      );
      if (!values.project_code || !values.category || missingTemplateRequired) {
        return null;
      }
    } else {
      const required = [values.project_code, values.originator_code, values.category, values.title_object, values.discipline_code];
      if (String(values.category || "").toUpperCase() !== "PD") {
        required.push(values.doc_type, values.serial_number);
      }
      if (required.some((item) => !item)) return null;
    }

    setComposing(true);
    try {
      const composed = await composeMdrCipher({
        ...values,
        category: values.category,
        values: valuesMap,
      });
      const normalizedCipher = normalizePdCipher(composed.cipher);
      form.setFieldValue("doc_number", normalizedCipher);
      return normalizedCipher;
    } catch (error) {
      if (editingMdrId && editingOriginalDocNumber) {
        // В редактировании неудачная перекомпоновка не должна стирать
        // рабочий шифр — возвращаем исходный.
        form.setFieldValue("doc_number", normalizePdCipher(editingOriginalDocNumber));
      } else {
        form.setFieldValue("doc_number", undefined);
      }
      message.error(error instanceof Error ? error.message : "Не удалось сформировать шифр");
      return null;
    } finally {
      setComposing(false);
    }
  };

  const checkCipher = async () => {
    const values = form.getFieldsValue(["project_code", "doc_number"]);
    if (!values.project_code || !values.doc_number) {
      setDocNumberExists(null);
      return;
    }
    // Собственный (неизменённый) шифр редактируемого документа — не дубликат.
    if (
      editingMdrId &&
      editingOriginalDocNumber &&
      normalizePdCipher(values.doc_number) === normalizePdCipher(editingOriginalDocNumber)
    ) {
      setDocNumberExists(false);
      return;
    }
    setChecking(true);
    try {
      const result = await checkMdrCipher(values.project_code, values.doc_number);
      setDocNumberExists(result.exists);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!currentProjectCode || !currentDisciplineCode || !serialAutoMode) return;
    // Авто-номер = НАИМЕНЬШИЙ свободный, а не max+1: после удаления
    // документа его номер снова доступен. Редактируемый документ
    // исключается — иначе форма затирала бы его собственный номер.
    const collectUsed = (matches: (item: MDRRecord) => boolean): Set<number> => {
      const used = new Set<number>();
      mdr.forEach((item) => {
        if (item.id === editingMdrId || !matches(item)) return;
        const match = /^(\d+)$/.exec(item.serial_number ?? "");
        if (match) used.add(Number(match[1]));
      });
      return used;
    };
    const lowestFree = (used: Set<number>): number => {
      let candidate = 1;
      while (used.has(candidate)) candidate += 1;
      return candidate;
    };
    if (isPdCategory) {
      // PD: «Книга» — необязательный суффикс, область — проект+раздел.
      const used = collectUsed(
        (item) => item.project_code === currentProjectCode && item.discipline_code === currentDisciplineCode,
      );
      form.setFieldValue("serial_number", String(lowestFree(used)).padStart(4, "0"));
      return;
    }
    // Остальные категории: порядковый номер уникален для полной комбинации
    // project+category+title_object+discipline_code+doc_type.
    if (!currentCategory || !currentTitleObject || !currentDocType) return;
    const used = collectUsed(
      (item) =>
        item.project_code === currentProjectCode &&
        item.category === currentCategory &&
        item.title_object === currentTitleObject &&
        item.discipline_code === currentDisciplineCode &&
        item.doc_type === currentDocType,
    );
    form.setFieldValue("serial_number", String(lowestFree(used)).padStart(3, "0"));
  }, [
    currentProjectCode,
    currentCategory,
    currentTitleObject,
    currentDisciplineCode,
    currentDocType,
    isPdCategory,
    serialAutoMode,
    editingMdrId,
    mdr,
    form,
  ]);

  useEffect(() => {
    // Автоподстановка категории проекта — ТОЛЬКО при создании. В режиме
    // редактирования этот эффект затирал реальную категорию документа:
    // resetFields→setFieldsValue мигает project_code, dep меняется,
    // и категория строки (SE) подменялась дефолтной (PD).
    if (editingMdrId) return;
    if (!selectedProject?.document_category) return;
    form.setFieldValue("category", selectedProject.document_category);
  }, [form, editingMdrId, selectedProject?.document_category]);

  useEffect(() => {
    setCipherTemplateFields([]);
  }, [selectedProject?.code, selectedProject?.document_category]);

  useEffect(() => {
    const hasTemplate = cipherTemplateFields.length > 0;
    const values = (allFormValues ?? {}) as Record<string, unknown>;
    const templateReady =
      currentProjectCode &&
      currentCategory &&
      cipherTemplateFields.every(
        (field) =>
          !field.required ||
          field.source_type === "STATIC" ||
          field.source_type === "AUTO_SERIAL" ||
          String(values[field.field_key] ?? "").trim().length > 0,
      );

    const legacyReady =
      currentProjectCode &&
      currentOriginatorCode &&
      currentCategory &&
      currentTitleObject &&
      currentDisciplineCode &&
      (isPdCategory || (currentDocType && currentSerialNumber));

    if (!(hasTemplate ? templateReady : legacyReady)) {
      setDocNumberExists(null);
      return;
    }

    const requestId = latestComposeRequestRef.current + 1;
    latestComposeRequestRef.current = requestId;

    const timer = setTimeout(async () => {
      const cipher = await composeCipher();
      if (!cipher || latestComposeRequestRef.current !== requestId) return;
      await checkCipher();
    }, 300);

    return () => clearTimeout(timer);
  }, [
    allFormValues,
    cipherTemplateFields,
    currentProjectCode,
    currentOriginatorCode,
    currentCategory,
    currentTitleObject,
    currentDisciplineCode,
    currentDocType,
    currentSerialNumber,
    isPdCategory,
  ]);

  const handleImportFile = async (file: File, dryRun: boolean): Promise<void> => {
    if (!selectedProject?.code) return;
    setImportingMdr(true);
    try {
      const result = await importMdr(selectedProject.code, file, dryRun);
      if (result.errors?.length) {
        Modal.error({
          title: dryRun ? "Проверка завершена с ошибками" : "Импорт завершен с ошибками",
          width: 720,
          content: (
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              {result.errors.map((item) => (
                <div key={`${item.row}-${item.message}`}>
                  Строка {item.row}: {item.message}
                </div>
              ))}
            </div>
          ),
        });
      } else {
        message.success(
          dryRun
            ? `Проверка успешна: готово к импорту ${result.imported}, пропущено ${result.skipped}`
            : `Импорт MDR: добавлено ${result.imported}, пропущено ${result.skipped}`,
        );
      }
      if (!dryRun) {
        await onCreated();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : dryRun ? "Ошибка проверки MDR" : "Ошибка импорта MDR");
    } finally {
      setImportingMdr(false);
    }
  };

  return (
    <>
      <Space wrap style={{ marginBottom: 12, alignItems: "center" }}>
        <Typography.Title level={4} style={{ margin: 0, whiteSpace: "nowrap", flexShrink: 0 }}>
          Реестр документов
        </Typography.Title>
        {/* Excel-операции собраны в один dropdown «Excel» — четыре кнопки в
            строке выглядели свалкой. Виден только тем у кого права на ведение
            реестра. Скрытые file-input'ы переиспользуются через ref. */}
        {projects[0]?.code && canManageMdr && (
          <>
            <input
              ref={importCheckRef}
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                await handleImportFile(file, true);
                e.currentTarget.value = "";
              }}
            />
            <input
              ref={importApplyRef}
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                await handleImportFile(file, false);
                e.currentTarget.value = "";
              }}
            />
            <Dropdown
              menu={{
                items: [
                  {
                    key: "template",
                    label: "Скачать шаблон",
                    onClick: async () => {
                      try {
                        await downloadMdrTemplate(projects[0].code);
                      } catch (error) {
                        message.error(error instanceof Error ? error.message : "Не удалось скачать шаблон");
                      }
                    },
                  },
                  {
                    key: "export",
                    label: "Экспорт реестра",
                    onClick: async () => {
                      try {
                        await exportMdr(projects[0].code);
                      } catch (error) {
                        message.error(error instanceof Error ? error.message : "Не удалось выгрузить Excel");
                      }
                    },
                  },
                  { type: "divider" as const },
                  {
                    key: "check",
                    label: "Проверить файл (dry-run)",
                    onClick: () => importCheckRef.current?.click(),
                  },
                  {
                    key: "import",
                    label: "Импорт реестра",
                    onClick: () => importApplyRef.current?.click(),
                  },
                ] as MenuProps["items"],
              }}
            >
              <Button icon={<FileExcelOutlined />} loading={importingMdr}>
                Excel <DownOutlined />
              </Button>
            </Dropdown>
          </>
        )}
        {canManageMdr && (
          <Button
            type="primary"
            onClick={() => {
              setEditingMdrId(null);
              setEditingOriginalDocNumber(null);
              setEditingHistoryLines([]);
              form.resetFields();
              setSerialAutoMode(true);
              setDocNumberExists(null);
              form.setFieldsValue({
                document_key: nextDocumentKey,
                project_code: defaultProjectCode,
                originator_code: defaultOriginator,
                category: projects[0]?.document_category ?? undefined,
              });
              setOpen(true);
            }}
          >
            + Добавить документ
          </Button>
        )}
      </Space>
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder="Поиск по шифру или названию"
          style={{ width: 320 }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {treeFilterLabel && (
          <Tag closable color="processing" onClose={() => onResetTreeFilter?.()}>
            Фильтр дерева: {treeFilterLabel}
          </Tag>
        )}
        <Typography.Text type="secondary">
          Показано {visibleMdr.length} из {mdr.length}
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={visibleMdr}
        size="small"
        scroll={{ x: 1280 }}
        pagination={paginationProps("mdr")}
        locale={{
          emptyText:
            search || treeFilterLabel
              ? "Ничего не найдено — измените поиск или снимите фильтр."
              : "МДР пуст. Добавьте документы через кнопку выше.",
        }}
      />

      <Modal
        open={open}
        title={editingMdrId ? "Карточка документа (редактирование)" : "Создать документ в реестре"}
        onCancel={() => {
          setOpen(false);
          setEditingMdrId(null);
          setEditingOriginalDocNumber(null);
          setEditingHistoryLines([]);
          setDocNumberExists(null);
          form.resetFields();
        }}
        onOk={submit}
        okButtonProps={{ loading: submitting }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="category" label="Категория документа" rules={[{ required: true }]}>
            <Select
              options={categoryOptions}
              placeholder="PD — проектная документация / SE — изыскания"
              onChange={() => {
                // Раздел зависит от категории (pd_section ↔ se_reporting_type).
                form.setFieldsValue({ discipline_code: undefined });
              }}
            />
          </Form.Item>
          <Form.Item name="document_key" label="Уникальный ID документа" rules={[{ required: true }]}>
            <Input readOnly={Boolean(editingMdrId)} />
          </Form.Item>
          <Form.Item name="project_code" label="Код проекта" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={isSingleProject}
              options={projects.map((project) => ({
                value: project.code,
                label: `${project.code} — ${project.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="originator_code"
            label="Код разработчика (3 символа)"
            normalize={(value: string) => (value ?? "").toUpperCase().slice(0, 3)}
            rules={[{ required: true }, { len: 3, message: "Ровно 3 символа" }, { pattern: /^[A-Z]{3}$/, message: "Только A-Z" }]}
          >
            <Input placeholder="CTR" maxLength={3} />
          </Form.Item>
          <Form.Item name="title_object" label="Титульный объект" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={titleObjectOptions} placeholder="Из справочника проекта" />
          </Form.Item>
          <Form.Item
            name="discipline_code"
            label={isPdCategory ? "Раздел ПД" : isSeCategory ? "Вид отчёта (SE)" : "Дисциплина"}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={disciplineOptions}
              placeholder={isPdCategory ? "Из справочника разделов ПД" : isSeCategory ? "Из справочника «SE отчеты»" : "Из справочника «Дисциплина»"}
            />
          </Form.Item>
          {missingReviewerNotice && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`По разделу «${missingReviewerNotice}» не назначен лидер-ревьювер (LR) заказчика`}
              description={
                <>
                  Документ создать нельзя — его некому рассматривать. Свяжитесь с администратором
                  системы заказчика, чтобы он завёл LR и R в матрице назначений проекта. Уведомление
                  ему уйдёт автоматически, если всё-таки нажать «Создать».
                </>
              }
            />
          )}
          {isPdCategory && (
            <Form.Item label="Номер раздела (инфо)">
              <Input value={currentSectionNumber} readOnly />
            </Form.Item>
          )}
          {isPdCategory ? (
            <Form.Item
              name="doc_type"
              label="Часть (необязательно, 1-2 цифры)"
              normalize={(value: string) => (value ?? "").replace(/\D/g, "").slice(0, 2)}
            >
              <Input placeholder="1" maxLength={2} />
            </Form.Item>
          ) : (
            <Form.Item name="doc_type" label="Тип документов" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={documentTypeOptions}
                placeholder="Из справочника «Тип документов»"
              />
            </Form.Item>
          )}
          {isPdCategory ? (
            <Form.Item
              name="serial_number"
              label="Книга (необязательно, 1-5 символов: цифры и точка)"
              normalize={(value: string) => (value ?? "").replace(/[^0-9.]/g, "").slice(0, 5)}
            >
              <Input
                placeholder="1.1"
                maxLength={5}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^0-9.]/g, "").slice(0, 5);
                  form.setFieldValue("serial_number", next);
                  setSerialAutoMode(false);
                }}
                addonAfter={
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      setSerialAutoMode(true);
                    }}
                  >
                    авто
                  </Button>
                }
              />
            </Form.Item>
          ) : (
            <Form.Item
              name="serial_number"
              label="Порядковый номер (авто, уникален для комбинации кодов)"
              // В старых записях серийник мог быть пустым (шифр собирался иначе).
              // При редактировании не требуем его — иначе документ невозможно
              // отредактировать вообще (например, поправить плановую дату).
              rules={editingMdrId ? [] : [{ required: true }]}
              normalize={(value: string) => (value ?? "").replace(/\D/g, "").slice(0, 6)}
            >
              <Input
                placeholder="001"
                maxLength={6}
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, "").slice(0, 6);
                  form.setFieldValue("serial_number", next);
                  setSerialAutoMode(false);
                }}
                addonAfter={
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      setSerialAutoMode(true);
                    }}
                  >
                    авто
                  </Button>
                }
              />
            </Form.Item>
          )}
          <Form.Item
            name="doc_number"
            label="Шифр документа (авто)"
            rules={[{ required: true }]}
            validateStatus={docNumberExists === true ? "error" : undefined}
            help={
              composing || checking
                ? "Формируем шифр…"
                : docNumberExists === true
                  ? "Шифр уже существует в этом проекте"
                  : docNumberExists === false
                    ? "Шифр уникален"
                    : undefined
            }
          >
            <Input placeholder="IMP-CTR-SE-1001-SE-RPT-001" readOnly />
          </Form.Item>
          {editingMdrId && editingHistoryLines.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">История изменений (последние 5):</Typography.Text>
              {editingHistoryLines.map((line) => (
                <div key={line}>
                  <Typography.Text type="secondary">{line}</Typography.Text>
                </div>
              ))}
            </div>
          )}
          <Form.Item name="doc_name" label="Наименование" rules={[{ required: true }]}>
            <Input placeholder="Piping layout" />
          </Form.Item>
          <Form.Item name="planned_dev_start" label="План выдачи ревизии A">
            <Input type="date" />
          </Form.Item>
          <Form.Item
            name="doc_weight"
            label={`Вес документа (текущий суммарный вес категории: ${categoryWeight}/1000)`}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={1000} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={deletingMdrId !== null}
        title="Удалить документ из реестра?"
        okText="Удалить"
        cancelText="Отмена"
        okButtonProps={{ danger: true, loading: deletingMdrLoading }}
        onCancel={() => setDeletingMdrId(null)}
        onOk={async () => {
          if (deletingMdrId === null) return;
          setDeletingMdrLoading(true);
          try {
            await deleteMdr(deletingMdrId);
            message.success("Документ удален");
            setDeletingMdrId(null);
            await onCreated();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "Не удалось удалить документ");
          } finally {
            setDeletingMdrLoading(false);
          }
        }}
      >
        Будут удалены связанные документы/ревизии/комментарии.
        {deletingChildCount > 0 && (
          <Typography.Paragraph type="danger" style={{ marginTop: 8, marginBottom: 0 }}>
            Вместе с ним будет удалено {deletingChildCount}{" "}
            {pluralNested(deletingChildCount)} и все их ревизии.
          </Typography.Paragraph>
        )}
      </Modal>

      <Modal
        open={childParent !== null}
        title={childParent ? `Вложенный документ под ${childParent.doc_number}` : "Вложенный документ"}
        okText="Создать вложенный"
        cancelText="Отмена"
        okButtonProps={{ loading: childSubmitting }}
        onCancel={() => {
          setChildParent(null);
          childForm.resetFields();
        }}
        onOk={async () => {
          if (!childParent) return;
          const values = await childForm.validateFields();
          setChildSubmitting(true);
          try {
            const created = await createChildMdr(childParent.id, {
              doc_name: values.doc_name,
              doc_weight: values.doc_weight ?? 0,
              planned_dev_start: values.planned_dev_start || null,
              serial: values.serial || null,
              title_object: values.title_object || null,
              discipline_code: values.discipline_code || null,
              doc_type: values.doc_type || null,
            });
            // Шифр показываем из ответа: при конфликте бэкенд подобрал
            // следующий свободный порядковый номер.
            message.success(`Вложенный документ создан: ${created.doc_number}`);
            setChildParent(null);
            childForm.resetFields();
            await onCreated();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "Не удалось создать вложенный документ");
          } finally {
            setChildSubmitting(false);
          }
        }}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Часть большего документа (напр. программа изысканий под отчётом). Порядок рассмотрения
          (LR/R) всегда берётся от головного документа. Шифр: <b>{childCipherPreview}</b>. Если такой
          шифр занят, порядковый номер увеличится на следующий свободный.
        </Typography.Paragraph>
        <Form form={childForm} layout="vertical">
          <Form.Item name="doc_name" label="Наименование вложенного документа" rules={[{ required: true, message: "Укажите наименование" }]}>
            <Input placeholder="Программа инженерно-геодезических изысканий" />
          </Form.Item>
          <Form.Item
            name="title_object"
            label="Титульный объект (титул)"
            tooltip="Пусто — как у родителя (шифр = шифр родителя + -NN). Свой титул, раздел или тип дают полный шифр по маске категории."
          >
            <AutoComplete
              allowClear
              options={titleObjectOptions}
              filterOption={(input, option) =>
                String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
              placeholder={childParent?.title_object ?? "как у родителя"}
            />
          </Form.Item>
          <Form.Item
            name="discipline_code"
            label={
              String(childParent?.category || "").toUpperCase() === "PD"
                ? "Раздел ПД"
                : String(childParent?.category || "").toUpperCase() === "SE"
                  ? "Вид отчёта (SE)"
                  : "Дисциплина"
            }
            tooltip="Пусто — как у родителя. Состав ревьюверов всё равно определяется по головному документу."
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={childDisciplineOptions}
              placeholder={childParent?.discipline_code ?? "как у родителя"}
            />
          </Form.Item>
          <Form.Item name="doc_type" label="Тип документа" tooltip="Пусто — как у родителя.">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={documentTypeOptions}
              placeholder={childParent?.doc_type ?? "как у родителя"}
            />
          </Form.Item>
          <Form.Item name="serial" label="Порядковый номер (необязательно, авто)" tooltip="1-4 символа. Пусто — следующий свободный (01, 02, …); при своём титуле — номер родителя">
            <Input placeholder="авто" maxLength={4} />
          </Form.Item>
          <Form.Item name="doc_weight" label="Вес (в бюджете категории)">
            <InputNumber min={0} style={{ width: "100%" }} placeholder="0" />
          </Form.Item>
          <Form.Item name="planned_dev_start" label="План выдачи ревизии A">
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
