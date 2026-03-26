import {
  ApartmentOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tooltip,
  Tree,
  Typography,
  Upload,
  message,
} from "antd";
import type { DataNode } from "antd/es/tree";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  buildDocumentViewUrl,
  createDocument,
  createMdrBulk,
  createRevision,
  downloadMdrImportTemplate,
  importMdrFromXlsx,
  listComments,
  listProjectReferences,
  listRevisions,
  uploadRevisionPdf,
} from "../api";
import type { CommentItem, DocumentItem, MDRRecord, ProjectItem, ProjectReference, Revision, User } from "../types";

type NodeKind = "project" | "category" | "mdr" | "document" | "revision";

interface TreeSelection {
  kind: NodeKind;
  projectCode?: string;
  category?: string;
  mdrId?: number;
  documentId?: number;
  revisionId?: number;
}

interface Props {
  currentUser: User;
  projects: ProjectItem[];
  mdr: MDRRecord[];
  documents: DocumentItem[];
  onReloadAll: () => Promise<void>;
  preselectedProjectCode?: string;
  preselectedCategory?: string;
}

export default function RegistryTreePage({
  currentUser,
  projects,
  mdr,
  documents,
  onReloadAll,
  preselectedProjectCode,
  preselectedCategory,
}: Props): JSX.Element {
  const [treeBusy, setTreeBusy] = useState(false);
  const [selected, setSelected] = useState<TreeSelection>({ kind: "project" });
  const [selectedTreeKey, setSelectedTreeKey] = useState<string>();
  const [revisionsByDoc, setRevisionsByDoc] = useState<Record<number, Revision[]>>({});
  const [commentsByRevision, setCommentsByRevision] = useState<Record<number, CommentItem[]>>({});
  const [refsByProject, setRefsByProject] = useState<Record<string, ProjectReference[]>>({});

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm] = Form.useForm();
  const [bulkRows, setBulkRows] = useState<
    Array<{
      key: string;
      document_key: string;
      title_object: string;
      discipline_code: string;
      doc_type: string;
      doc_name: string;
      doc_weight: number;
    }>
  >([
    {
      key: "1",
      document_key: "",
      title_object: "",
      discipline_code: "",
      doc_type: "",
      doc_name: "",
      doc_weight: 1,
    },
  ]);
  const [importing, setImporting] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [docOpen, setDocOpen] = useState(false);
  const [docForm] = Form.useForm();
  const [revisionUploadOpen, setRevisionUploadOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionForm] = Form.useForm();
  const [docFilters, setDocFilters] = useState<{
    documentIds: number[];
    disciplines: string[];
    docTypes: string[];
  }>({ documentIds: [], disciplines: [], docTypes: [] });

  const mdrByProjectCategory = useMemo(() => {
    const map = new Map<string, MDRRecord[]>();
    for (const row of mdr) {
      const key = `${row.project_code}::${row.category}`;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [mdr]);

  const documentsByMdr = useMemo(() => {
    const map = new Map<number, DocumentItem[]>();
    for (const doc of documents) {
      const list = map.get(doc.mdr_id) ?? [];
      list.push(doc);
      map.set(doc.mdr_id, list);
    }
    return map;
  }, [documents]);

  useEffect(() => {
    const ensureRevisionData = async () => {
      const missingDocIds = documents.filter((doc) => revisionsByDoc[doc.id] === undefined).map((doc) => doc.id);
      if (missingDocIds.length === 0) {
        return;
      }
      setTreeBusy(true);
      const updates: Record<number, Revision[]> = {};
      for (const docId of missingDocIds) {
        try {
          updates[docId] = await listRevisions(docId);
        } catch {
          updates[docId] = [];
        }
      }
      setRevisionsByDoc((prev) => ({ ...prev, ...updates }));
      setTreeBusy(false);
    };
    void ensureRevisionData();
  }, [documents, revisionsByDoc]);

  useEffect(() => {
    const ensureComments = async () => {
      const allRevisions = Object.values(revisionsByDoc).flat();
      const missingRevisionIds = allRevisions
        .filter((rev) => commentsByRevision[rev.id] === undefined)
        .map((rev) => rev.id);
      if (missingRevisionIds.length === 0) {
        return;
      }
      setTreeBusy(true);
      const updates: Record<number, CommentItem[]> = {};
      for (const revisionId of missingRevisionIds) {
        try {
          updates[revisionId] = await listComments(revisionId);
        } catch {
          updates[revisionId] = [];
        }
      }
      setCommentsByRevision((prev) => ({ ...prev, ...updates }));
      setTreeBusy(false);
    };
    void ensureComments();
  }, [commentsByRevision, revisionsByDoc]);

  useEffect(() => {
    const ensureProjectRefs = async () => {
      const missingProjects = projects.filter((p) => refsByProject[p.code] === undefined);
      if (missingProjects.length === 0) {
        return;
      }
      setTreeBusy(true);
      const next: Record<string, ProjectReference[]> = {};
      for (const p of missingProjects) {
        try {
          next[p.code] = await listProjectReferences(p.id);
        } catch {
          next[p.code] = [];
        }
      }
      setRefsByProject((prev) => ({ ...prev, ...next }));
      setTreeBusy(false);
    };
    void ensureProjectRefs();
  }, [projects, refsByProject]);

  const treeData: DataNode[] = useMemo(() => {
    const nodes: DataNode[] = [];
    for (const project of projects) {
      const refs = refsByProject[project.code] ?? [];
      const categories = refs
        .filter((r) => r.ref_type === "document_category" && r.is_active)
        .sort((a, b) => a.code.localeCompare(b.code))
        .filter((categoryRef) => {
          const categoryMdrRows = mdrByProjectCategory.get(`${project.code}::${categoryRef.code}`) ?? [];
          return categoryMdrRows.some((row) => (documentsByMdr.get(row.id) ?? []).length > 0);
        });
      const categoryNodes: DataNode[] = categories.map((categoryRef) => {
        const category = categoryRef.code;
        const mdrRows = (mdrByProjectCategory.get(`${project.code}::${category}`) ?? []).sort((a, b) =>
          a.doc_number.localeCompare(b.doc_number),
        );
        const mdrNodes: DataNode[] = mdrRows.map((mdrRow) => {
          const docs = (documentsByMdr.get(mdrRow.id) ?? []).sort((a, b) => a.document_num.localeCompare(b.document_num));
          const documentNodes: DataNode[] = docs.map((doc) => {
            const revisions = (revisionsByDoc[doc.id] ?? []).sort((a, b) => a.revision_code.localeCompare(b.revision_code));
            const revisionNodes: DataNode[] = revisions.map((rev) => {
              const commentCount = (commentsByRevision[rev.id] ?? []).length;
              return {
                key: `revision:${rev.id}`,
                title: `${rev.revision_code} (${commentCount} comments)`,
                icon: <FileSearchOutlined />,
                isLeaf: true,
              };
            });
            return {
              key: `document:${doc.id}`,
              title: `${doc.document_num} — ${doc.title}`,
              icon: <FileTextOutlined />,
              children: revisionNodes,
            };
          });
          return {
            key: `mdr:${mdrRow.id}`,
            title: `${mdrRow.doc_number} — ${mdrRow.doc_name}`,
            icon: <FileTextOutlined />,
            children: documentNodes,
          };
        });
        return {
          key: `category:${project.code}:${category}`,
          title: `${category} — ${categoryRef.value}`,
          icon: <FolderOpenOutlined />,
          children: mdrNodes,
        };
      });
      nodes.push({
        key: `project:${project.code}`,
        title: `${project.code} — ${project.name}`,
        icon: <ApartmentOutlined />,
        children: categoryNodes,
      });
    }
    return nodes;
  }, [commentsByRevision, documentsByMdr, mdrByProjectCategory, projects, refsByProject, revisionsByDoc]);

  useEffect(() => {
    if (!preselectedProjectCode) {
      return;
    }
    if (preselectedCategory) {
      const categoryKey = `category:${preselectedProjectCode}:${preselectedCategory}`;
      setSelectedTreeKey(categoryKey);
      setSelected({
        kind: "category",
        projectCode: preselectedProjectCode,
        category: preselectedCategory,
      });
      return;
    }
    const projectKey = `project:${preselectedProjectCode}`;
    setSelectedTreeKey(projectKey);
    setSelected({
      kind: "project",
      projectCode: preselectedProjectCode,
    });
  }, [preselectedProjectCode, preselectedCategory]);

  const selectedMdrRows = useMemo(() => {
    if (selected.projectCode && selected.category) {
      return (mdrByProjectCategory.get(`${selected.projectCode}::${selected.category}`) ?? []).sort((a, b) =>
        a.doc_number.localeCompare(b.doc_number),
      );
    }
    if (selected.mdrId) {
      return mdr.filter((row) => row.id === selected.mdrId);
    }
    return [];
  }, [mdr, mdrByProjectCategory, selected]);

  const selectedDocumentRows = useMemo(() => {
    if (selected.mdrId) {
      return (documentsByMdr.get(selected.mdrId) ?? []).sort((a, b) => a.document_num.localeCompare(b.document_num));
    }
    if (selected.documentId) {
      return documents.filter((doc) => doc.id === selected.documentId);
    }
    return [];
  }, [documents, documentsByMdr, selected.documentId, selected.mdrId]);

  const selectedRevisionRows = useMemo(() => {
    if (selected.documentId) {
      return revisionsByDoc[selected.documentId] ?? [];
    }
    if (selected.revisionId) {
      for (const list of Object.values(revisionsByDoc)) {
        const found = list.find((item) => item.id === selected.revisionId);
        if (found) {
          return [found];
        }
      }
    }
    return [];
  }, [revisionsByDoc, selected.documentId, selected.revisionId]);

  const selectedCommentRows = useMemo(() => {
    if (selected.revisionId) {
      return commentsByRevision[selected.revisionId] ?? [];
    }
    return [];
  }, [commentsByRevision, selected.revisionId]);

  const filteredMdrRows = useMemo(() => {
    return selectedMdrRows.filter((row) => {
      const docs = documentsByMdr.get(row.id) ?? [];
      if (docFilters.documentIds.length > 0 && !docs.some((doc) => docFilters.documentIds.includes(doc.id))) {
        return false;
      }
      if (docFilters.disciplines.length > 0 && !docFilters.disciplines.includes(row.discipline_code)) {
        return false;
      }
      if (docFilters.docTypes.length > 0 && !docFilters.docTypes.includes(row.doc_type)) {
        return false;
      }
      return true;
    });
  }, [docFilters.disciplines, docFilters.docTypes, docFilters.documentIds, documentsByMdr, selectedMdrRows]);

  const filteredDocumentRows = useMemo(() => {
    return selectedDocumentRows.filter((doc) => {
      if (docFilters.documentIds.length > 0 && !docFilters.documentIds.includes(doc.id)) {
        return false;
      }
      if (docFilters.disciplines.length > 0 && !docFilters.disciplines.includes(doc.discipline)) {
        return false;
      }
      const mdrRow = mdr.find((row) => row.id === doc.mdr_id);
      if (docFilters.docTypes.length > 0 && mdrRow && !docFilters.docTypes.includes(mdrRow.doc_type)) {
        return false;
      }
      return true;
    });
  }, [docFilters.disciplines, docFilters.docTypes, docFilters.documentIds, mdr, selectedDocumentRows]);

  const availableFilterOptions = useMemo(() => {
    const visibleDocs =
      selected.projectCode && selected.category
        ? (mdrByProjectCategory.get(`${selected.projectCode}::${selected.category}`) ?? []).flatMap(
            (row) => documentsByMdr.get(row.id) ?? [],
          )
        : selectedDocumentRows;

    const documentsOpts = visibleDocs
      .map((doc) => ({ value: doc.id, label: `${doc.document_num} — ${doc.title}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const disciplinesOpts = Array.from(new Set(visibleDocs.map((doc) => doc.discipline)))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
    const docTypesOpts = Array.from(
      new Set(
        visibleDocs
          .map((doc) => mdr.find((row) => row.id === doc.mdr_id)?.doc_type)
          .filter((value): value is string => Boolean(value)),
      ),
    )
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));

    return { documentsOpts, disciplinesOpts, docTypesOpts };
  }, [documentsByMdr, mdr, mdrByProjectCategory, selected.category, selected.projectCode, selectedDocumentRows]);

  useEffect(() => {
    setDocFilters((prev) => ({
      documentIds: prev.documentIds.filter((value) => availableFilterOptions.documentsOpts.some((item) => item.value === value)),
      disciplines: prev.disciplines.filter((value) =>
        availableFilterOptions.disciplinesOpts.some((item) => item.value === value),
      ),
      docTypes: prev.docTypes.filter((value) => availableFilterOptions.docTypesOpts.some((item) => item.value === value)),
    }));
  }, [availableFilterOptions.disciplinesOpts, availableFilterOptions.docTypesOpts, availableFilterOptions.documentsOpts]);

  const refsForSelectedProject = selected.projectCode ? refsByProject[selected.projectCode] ?? [] : [];
  const categoryOptions = refsForSelectedProject
    .filter((r) => r.ref_type === "document_category" && r.is_active)
    .map((r) => ({ value: r.code, label: `${r.code} — ${r.value}` }));
  const titleOptions = refsForSelectedProject
    .filter((r) => r.ref_type === "facility_title" && r.is_active)
    .map((r) => ({ value: r.code, label: `${r.code} — ${r.value}` }));
  const disciplineOptions = refsForSelectedProject
    .filter((r) => r.ref_type === "discipline" && r.is_active)
    .map((r) => ({ value: r.code, label: `${r.code} — ${r.value}` }));
  const selectedBulkCategory = Form.useWatch("category", bulkForm) ?? selected.category;
  const docTypeOptions = (selectedBulkCategory === "SE"
    ? refsForSelectedProject.filter((r) => r.ref_type === "se_reporting_type" && r.is_active)
    : selectedBulkCategory === "PD"
      ? refsForSelectedProject.filter((r) => r.ref_type === "pd_book" && r.is_active)
      : refsForSelectedProject.filter((r) => r.ref_type === "document_type" && r.is_active)
  ).map((r) => ({ value: r.code, label: `${r.code} — ${r.value}` }));

  const mdrColumns: ColumnsType<MDRRecord> = [
    { title: "Шифр / Number", dataIndex: "doc_number", key: "doc_number" },
    { title: "Наименование / Name", dataIndex: "doc_name", key: "doc_name" },
    { title: "Дисциплина", dataIndex: "discipline_code", key: "discipline_code" },
    { title: "Тип", dataIndex: "doc_type", key: "doc_type" },
    { title: "Вес, %", dataIndex: "doc_weight", key: "doc_weight" },
  ];

  const docColumns: ColumnsType<DocumentItem> = [
    { title: "Шифр / Number", dataIndex: "document_num", key: "document_num" },
    { title: "Название / Title", dataIndex: "title", key: "title" },
    { title: "Дисциплина / Discipline", dataIndex: "discipline", key: "discipline" },
    { title: "Вес", dataIndex: "weight", key: "weight" },
  ];

  const revisionColumns: ColumnsType<Revision> = [
    { title: "Ревизия", dataIndex: "revision_code", key: "revision_code" },
    { title: "Цель", dataIndex: "issue_purpose", key: "issue_purpose" },
    { title: "Статус", dataIndex: "status", key: "status" },
    { title: "Файл", dataIndex: "file_path", key: "file_path", render: (v) => v ?? "—" },
  ];

  const commentColumns: ColumnsType<CommentItem> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    { title: "Текст", dataIndex: "text", key: "text" },
    { title: "Статус", dataIndex: "status", key: "status", width: 140 },
    { title: "Лист", dataIndex: "page", key: "page", width: 80, render: (v) => v ?? "—" },
  ];

  const onTreeSelect = (keys: React.Key[]) => {
    const raw = keys[0];
    if (!raw || typeof raw !== "string") {
      return;
    }
    setSelectedTreeKey(raw);
    if (raw.startsWith("project:")) {
      const projectCode = raw.split(":")[1];
      setSelected({ kind: "project", projectCode });
      return;
    }
    if (raw.startsWith("category:")) {
      const [, projectCode, category] = raw.split(":");
      setSelected({ kind: "category", projectCode, category });
      return;
    }
    if (raw.startsWith("mdr:")) {
      const mdrId = Number(raw.split(":")[1]);
      const mdrRow = mdr.find((row) => row.id === mdrId);
      setSelected({
        kind: "mdr",
        mdrId,
        projectCode: mdrRow?.project_code,
        category: mdrRow?.category,
      });
      return;
    }
    if (raw.startsWith("document:")) {
      const documentId = Number(raw.split(":")[1]);
      const doc = documents.find((row) => row.id === documentId);
      const mdrRow = mdr.find((row) => row.id === doc?.mdr_id);
      setSelected({
        kind: "document",
        documentId,
        mdrId: doc?.mdr_id,
        projectCode: mdrRow?.project_code,
        category: mdrRow?.category,
      });
      return;
    }
    if (raw.startsWith("revision:")) {
      const revisionId = Number(raw.split(":")[1]);
      let documentId: number | undefined;
      for (const [docIdText, list] of Object.entries(revisionsByDoc)) {
        const match = list.find((item) => item.id === revisionId);
        if (match) {
          documentId = Number(docIdText);
          break;
        }
      }
      const doc = documentId ? documents.find((row) => row.id === documentId) : undefined;
      const mdrRow = doc ? mdr.find((row) => row.id === doc.mdr_id) : undefined;
      setSelected({
        kind: "revision",
        revisionId,
        documentId,
        mdrId: doc?.mdr_id,
        projectCode: mdrRow?.project_code,
        category: mdrRow?.category,
      });
    }
  };

  const openBulkCreate = () => {
    if (!selected.projectCode || !selected.category) {
      message.warning("Сначала выберите категорию в дереве");
      return;
    }
    bulkForm.setFieldsValue({ project_code: selected.projectCode, category: selected.category });
    setBulkOpen(true);
  };

  const addBulkRow = () => {
    setBulkRows((prev) => [
      ...prev,
      {
        key: String(prev.length + 1),
        document_key: "",
        title_object: "",
        discipline_code: "",
        doc_type: "",
        doc_name: "",
        doc_weight: 1,
      },
    ]);
  };

  const updateBulkRow = (index: number, field: string, value: string | number) => {
    setBulkRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const submitBulk = async () => {
    const root = await bulkForm.validateFields();
    const rows = bulkRows
      .map((row) => ({
        ...row,
        document_key: row.document_key.trim(),
        title_object: row.title_object.trim(),
        discipline_code: row.discipline_code.trim(),
        doc_type: row.doc_type.trim(),
        doc_name: row.doc_name.trim(),
      }))
      .filter((row) => row.document_key && row.title_object && row.discipline_code && row.doc_type && row.doc_name);
    if (rows.length === 0) {
      message.warning("Добавьте минимум одну строку");
      return;
    }
    await createMdrBulk({ project_code: root.project_code, category: root.category, rows });
    message.success(`Создано записей MDR: ${rows.length}`);
    setBulkOpen(false);
    setBulkRows([
      {
        key: "1",
        document_key: "",
        title_object: "",
        discipline_code: "",
        doc_type: "",
        doc_name: "",
        doc_weight: 1,
      },
    ]);
    await onReloadAll();
  };

  const submitImport = async () => {
    const root = await bulkForm.validateFields();
    if (!uploadFile) {
      message.warning("Выберите Excel файл");
      return;
    }
    setImporting(true);
    try {
      const result = await importMdrFromXlsx(root.project_code, root.category, uploadFile);
      if (result.failed_count > 0) {
        message.warning(
          `Импорт завершен частично. Создано: ${result.created_count}, ошибок: ${result.failed_count}. Проверьте детали в backend response.`,
        );
      } else {
        message.success(`Импорт выполнен. Создано записей: ${result.created_count}`);
      }
      setUploadFile(null);
      await onReloadAll();
    } finally {
      setImporting(false);
    }
  };

  const submitCreateDocument = async () => {
    if (!selected.mdrId) {
      message.warning("Выберите запись MDR");
      return;
    }
    const values = await docForm.validateFields();
    await createDocument({
      mdr_id: selected.mdrId,
      document_num: values.document_num,
      title: values.title,
      discipline: values.discipline,
      weight: values.weight,
    });
    setDocOpen(false);
    docForm.resetFields();
    await onReloadAll();
  };

  const submitCreateRevision = async () => {
    if (!selected.documentId) {
      message.warning("Выберите документ");
      return;
    }
    const values = await revisionForm.validateFields();
    await createRevision({
      document_id: selected.documentId,
      revision_code: values.revision_code,
      issue_purpose: values.issue_purpose,
      status: values.status,
      trm_number: values.trm_number,
    });
    message.success("Ревизия создана");
    setRevisionOpen(false);
    revisionForm.resetFields();
    await onReloadAll();
  };

  const submitRevisionPdf = async () => {
    if (!selected.revisionId || !uploadFile) {
      message.warning("Выберите ревизию и PDF");
      return;
    }
    await uploadRevisionPdf(selected.revisionId, uploadFile);
    message.success("PDF загружен");
    setRevisionUploadOpen(false);
    setUploadFile(null);
    await onReloadAll();
  };

  const canManageMdr = currentUser.role === "admin" || Boolean(currentUser.can_manage_mdr);
  const canCreateDocument = selected.mdrId !== undefined;
  const canCreateRevision =
    selected.documentId !== undefined &&
    (currentUser.role === "admin" || currentUser.role === "contractor_manager" || currentUser.role === "contractor_author");
  const selectedDocumentCard = selected.documentId
    ? documents.find((doc) => doc.id === selected.documentId) ?? null
    : null;
  const selectedDocumentMdr = selectedDocumentCard ? mdr.find((row) => row.id === selectedDocumentCard.mdr_id) ?? null : null;

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Card>
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Иерархия документации / Documentation Tree
          </Typography.Title>
          <Typography.Text type="secondary">
            Проект → Категория документации → MDR → Документ → Ревизии (+ PDF, комментарии)
          </Typography.Text>
          <Alert
            type="info"
            showIcon
            message="HRP-подобный поток"
            description="Слева дерево структуры, справа рабочие таблицы и действия. Это основной экран реестра для ежедневной работы."
          />
        </Space>
      </Card>

      <Row gutter={16}>
        <Col span={8}>
          <Card title="Структура проекта" styles={{ body: { maxHeight: 760, overflow: "auto" } }}>
            <Tree
              showIcon
              selectedKeys={selectedTreeKey ? [selectedTreeKey] : []}
              treeData={treeData}
              onSelect={onTreeSelect}
              defaultExpandAll
            />
            {treeBusy && (
              <Typography.Text type="secondary">Загрузка иерархии...</Typography.Text>
            )}
          </Card>
        </Col>

        <Col span={16}>
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Card
              title="Быстрые действия"
              extra={
                <Space>
                  <Tooltip title="Скачать шаблон Excel для массового импорта записей MDR">
                    <Button onClick={() => void downloadMdrImportTemplate()}>Шаблон Excel</Button>
                  </Tooltip>
                  <Button type="primary" disabled={!canManageMdr} onClick={openBulkCreate}>
                    Массовое создание MDR
                  </Button>
                  <Button disabled={!canCreateDocument} onClick={() => setDocOpen(true)}>
                    Добавить документ
                  </Button>
                  <Button disabled={!canCreateRevision} onClick={() => setRevisionOpen(true)}>
                    Добавить ревизию
                  </Button>
                  <Button disabled={!selected.revisionId} icon={<UploadOutlined />} onClick={() => setRevisionUploadOpen(true)}>
                    Загрузить PDF в ревизию
                  </Button>
                </Space>
              }
            >
              <Typography.Text>
                Текущий выбор:{" "}
                <strong>
                  {selected.kind}
                  {selected.projectCode ? ` | ${selected.projectCode}` : ""}
                  {selected.category ? ` | ${selected.category}` : ""}
                  {selected.mdrId ? ` | MDR#${selected.mdrId}` : ""}
                  {selected.documentId ? ` | DOC#${selected.documentId}` : ""}
                  {selected.revisionId ? ` | REV#${selected.revisionId}` : ""}
                </strong>
              </Typography.Text>
            </Card>

            <Card>
              <Space wrap style={{ marginBottom: 12 }}>
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Фильтр: документ"
                  style={{ minWidth: 260 }}
                  value={docFilters.documentIds}
                  onChange={(values) => setDocFilters((prev) => ({ ...prev, documentIds: values }))}
                  options={availableFilterOptions.documentsOpts}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Фильтр: дисциплина"
                  style={{ minWidth: 220 }}
                  value={docFilters.disciplines}
                  onChange={(values) => setDocFilters((prev) => ({ ...prev, disciplines: values }))}
                  options={availableFilterOptions.disciplinesOpts}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Фильтр: тип документа"
                  style={{ minWidth: 220 }}
                  value={docFilters.docTypes}
                  onChange={(values) => setDocFilters((prev) => ({ ...prev, docTypes: values }))}
                  options={availableFilterOptions.docTypesOpts}
                />
                <Button onClick={() => setDocFilters({ documentIds: [], disciplines: [], docTypes: [] })}>
                  Сбросить фильтры
                </Button>
              </Space>
              <Tabs
                items={[
                  {
                    key: "mdr",
                    label: "MDR записи",
                    children: (
                      <Table
                        rowKey="id"
                        size="small"
                        columns={mdrColumns}
                        dataSource={filteredMdrRows}
                        pagination={{ pageSize: 10 }}
                      />
                    ),
                  },
                  {
                    key: "documents",
                    label: "Документы",
                    children: (
                      <Table
                        rowKey="id"
                        size="small"
                        columns={docColumns}
                        dataSource={filteredDocumentRows}
                        pagination={{ pageSize: 10 }}
                      />
                    ),
                  },
                  {
                    key: "revisions",
                    label: "Ревизии",
                    children: (
                      <Table
                        rowKey="id"
                        size="small"
                        columns={revisionColumns}
                        dataSource={selectedRevisionRows}
                        pagination={{ pageSize: 10 }}
                      />
                    ),
                  },
                  {
                    key: "comments",
                    label: "Комментарии",
                    children: (
                      <Table
                        rowKey="id"
                        size="small"
                        columns={commentColumns}
                        dataSource={selectedCommentRows}
                        pagination={{ pageSize: 10 }}
                      />
                    ),
                  },
                ]}
              />
            </Card>

            {selectedDocumentCard && (
              <Card title={`Карточка документа: ${selectedDocumentCard.document_num}`}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Typography.Paragraph>
                      <strong>Название:</strong> {selectedDocumentCard.title}
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      <strong>Дисциплина:</strong> {selectedDocumentCard.discipline}
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      <strong>Вес:</strong> {selectedDocumentCard.weight}
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      <strong>Создан:</strong> {selectedDocumentCard.created_at}
                    </Typography.Paragraph>
                  </Col>
                  <Col span={12}>
                    <Typography.Paragraph>
                      <strong>Проект:</strong> {selectedDocumentMdr?.project_code ?? "—"}
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      <strong>Категория:</strong> {selectedDocumentMdr?.category ?? "—"}
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      <strong>Тип документа:</strong> {selectedDocumentMdr?.doc_type ?? "—"}
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      <strong>Прогресс:</strong> {selectedDocumentMdr?.progress_percent ?? 0}%
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      <strong>Код ревью:</strong> {selectedDocumentMdr?.review_code ?? "—"}
                    </Typography.Paragraph>
                  </Col>
                </Row>
                <Space>
                  {selectedRevisionRows[0] && selectedRevisionRows[0].file_path ? (
                    <Button href={buildDocumentViewUrl(selectedRevisionRows[0].id)} target="_blank">
                      Открыть PDF текущей ревизии
                    </Button>
                  ) : (
                    <Typography.Text type="secondary">PDF в текущей ревизии еще не загружен</Typography.Text>
                  )}
                </Space>
              </Card>
            )}
          </Space>
        </Col>
      </Row>

      <Modal
        open={bulkOpen}
        width={1180}
        onCancel={() => setBulkOpen(false)}
        onOk={() => void submitBulk()}
        title="Массовое создание MDR"
      >
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Form form={bulkForm} layout="inline">
            <Form.Item name="project_code" label="Проект" rules={[{ required: true }]}>
              <Select
                style={{ width: 200 }}
                options={projects.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))}
                onChange={(value) => {
                  setSelected({
                    kind: "project",
                    projectCode: value,
                  });
                }}
              />
            </Form.Item>
            <Form.Item name="category" label="Категория" rules={[{ required: true }]}>
              <Select style={{ width: 260 }} options={categoryOptions} />
            </Form.Item>
            <Button onClick={addBulkRow}>+ Строка</Button>
          </Form>

          <Table
            rowKey="key"
            size="small"
            dataSource={bulkRows}
            pagination={false}
            columns={[
              {
                title: "Document Key",
                render: (_, row, index) => (
                  <Input
                    value={row.document_key}
                    onChange={(e) => updateBulkRow(index, "document_key", e.target.value)}
                    placeholder="DOC-001"
                  />
                ),
              },
              {
                title: "Титул",
                render: (_, row, index) => (
                  <Select
                    showSearch
                    style={{ minWidth: 160 }}
                    options={titleOptions}
                    value={row.title_object || undefined}
                    onChange={(v) => updateBulkRow(index, "title_object", v)}
                  />
                ),
              },
              {
                title: "Дисциплина",
                render: (_, row, index) => (
                  <Select
                    showSearch
                    style={{ minWidth: 170 }}
                    options={disciplineOptions}
                    value={row.discipline_code || undefined}
                    onChange={(v) => updateBulkRow(index, "discipline_code", v)}
                  />
                ),
              },
              {
                title: "Тип документа",
                render: (_, row, index) => (
                  <Select
                    showSearch
                    style={{ minWidth: 170 }}
                    options={docTypeOptions}
                    value={row.doc_type || undefined}
                    onChange={(v) => updateBulkRow(index, "doc_type", v)}
                  />
                ),
              },
              {
                title: "Наименование",
                render: (_, row, index) => (
                  <Input value={row.doc_name} onChange={(e) => updateBulkRow(index, "doc_name", e.target.value)} />
                ),
              },
              {
                title: "Вес %",
                width: 100,
                render: (_, row, index) => (
                  <InputNumber
                    min={0}
                    max={100}
                    value={row.doc_weight}
                    onChange={(v) => updateBulkRow(index, "doc_weight", Number(v ?? 0))}
                  />
                ),
              },
            ]}
          />

          <Card size="small" title="Импорт через Excel">
            <Space>
              <Upload
                beforeUpload={(file) => {
                  if (!file.name.toLowerCase().endsWith(".xlsx")) {
                    message.error("Нужен файл .xlsx");
                    return Upload.LIST_IGNORE;
                  }
                  setUploadFile(file as File);
                  return false;
                }}
                maxCount={1}
                onRemove={() => setUploadFile(null)}
              >
                <Button icon={<UploadOutlined />}>Выбрать Excel</Button>
              </Upload>
              <Button loading={importing} onClick={() => void submitImport()}>
                Импортировать
              </Button>
              <Typography.Text type="secondary">
                Сначала скачайте шаблон, заполните, затем импортируйте.
              </Typography.Text>
            </Space>
          </Card>
        </Space>
      </Modal>

      <Modal open={docOpen} onCancel={() => setDocOpen(false)} onOk={() => void submitCreateDocument()} title="Создать документ">
        <Form form={docForm} layout="vertical">
          <Form.Item name="document_num" label="Шифр документа" rules={[{ required: true }]}>
            <Input placeholder="Используйте шифр MDR или дочерний номер" />
          </Form.Item>
          <Form.Item name="title" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="discipline" label="Дисциплина" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="weight" label="Вес" initialValue={1}>
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={revisionOpen} onCancel={() => setRevisionOpen(false)} onOk={() => void submitCreateRevision()} title="Создать ревизию">
        <Form form={revisionForm} layout="vertical" initialValues={{ status: "SUBMITTED" }}>
          <Form.Item name="revision_code" label="Код ревизии" rules={[{ required: true }]}>
            <Input placeholder="A" />
          </Form.Item>
          <Form.Item name="issue_purpose" label="Цель выпуска" rules={[{ required: true }]}>
            <Input placeholder="IFR" />
          </Form.Item>
          <Form.Item name="status" label="Статус" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "DRAFT", label: "DRAFT" },
                { value: "SUBMITTED", label: "SUBMITTED" },
                { value: "IN_REVIEW", label: "IN_REVIEW" },
              ]}
            />
          </Form.Item>
          <Form.Item name="trm_number" label="TRM номер">
            <Input placeholder="TRM-001" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={revisionUploadOpen}
        onCancel={() => setRevisionUploadOpen(false)}
        onOk={() => void submitRevisionPdf()}
        title="Загрузка PDF в ревизию"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text>Ревизия: {selected.revisionId ?? "—"}</Typography.Text>
          <Upload
            beforeUpload={(file) => {
              if (file.type !== "application/pdf") {
                message.error("Можно загружать только PDF");
                return Upload.LIST_IGNORE;
              }
              setUploadFile(file as File);
              return false;
            }}
            maxCount={1}
            onRemove={() => setUploadFile(null)}
          >
            <Button icon={<UploadOutlined />}>Выбрать PDF</Button>
          </Upload>
        </Space>
      </Modal>
    </Space>
  );
}
