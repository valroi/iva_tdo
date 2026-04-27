import { InboxOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Space, Table, Tree, Typography, Upload, message } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import type { DataNode } from "antd/es/tree";
import { useEffect, useMemo, useState } from "react";

import {
  deleteSmartUploadRegistryItem,
  fetchSmartUploadFileBlob,
  listSmartUploadRegistry,
  smartUploadProcessBatch,
  smartUploadPreview,
  smartUploadProcess,
  updateSmartUploadRegistryItem,
  type SmartUploadRegistryItem,
  type SmartUploadPreviewResult,
  type SmartUploadBatchProcessResult,
  type SmartUploadProcessResult,
  type SmartUploadTreeNode,
} from "../api";

type FieldMap = Record<string, string>;

const FIELD_ORDER = [
  "cipher",
  "project",
  "document_category",
  "unit",
  "title_code",
  "discipline",
  "doc_type",
  "serial",
  "revision",
  "title_text",
];

const FIELD_LABELS: Record<string, string> = {
  cipher: "Шифр",
  project: "Проект",
  document_category: "Категория документа",
  unit: "Объект/Юнит",
  title_code: "Титул",
  discipline: "Дисциплина",
  doc_type: "Тип документа",
  serial: "Номер документа",
  revision: "Ревизия",
  title_text: "Название документа",
};

export default function DocCheckerPage(): JSX.Element {
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [relatedFiles, setRelatedFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<SmartUploadPreviewResult | null>(null);
  const [processingResult, setProcessingResult] = useState<SmartUploadProcessResult | null>(null);
  const [batchResult, setBatchResult] = useState<SmartUploadBatchProcessResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingProcess, setLoadingProcess] = useState(false);
  const [loadingBatchProcess, setLoadingBatchProcess] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  type HierarchyKey =
    | "project"
    | "document_category"
    | "document_class"
    | "discipline"
    | "title_code"
    | "issue_purpose"
    | "cipher_no_revision"
    | "revision";
  const [hierarchyOrder, setHierarchyOrder] = useState<HierarchyKey[]>([
    "project",
    "document_category",
    "document_class",
    "discipline",
    "title_code",
    "issue_purpose",
    "cipher_no_revision",
    "revision",
  ]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registry, setRegistry] = useState<SmartUploadRegistryItem[]>([]);
  const [docChatQuery, setDocChatQuery] = useState("");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewPdfTitle, setPreviewPdfTitle] = useState<string>("");
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string>("");
  const [editingEntryKey, setEditingEntryKey] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<Record<string, string>>({});
  const [form] = Form.useForm<FieldMap>();
  const hierarchyLabels: Record<HierarchyKey, string> = {
    project: "Проект",
    document_category: "Категория",
    document_class: "Класс",
    discipline: "Дисциплина",
    title_code: "Титул",
    issue_purpose: "Цель выпуска",
    cipher_no_revision: "Шифр без ревизии",
    revision: "Ревизия",
  };

  const loadTree = async () => {
    setTreeLoading(true);
    try {
      await loadRegistry();
    } finally {
      setTreeLoading(false);
    }
  };

  const loadRegistry = async () => {
    setRegistryLoading(true);
    try {
      const items = await listSmartUploadRegistry();
      setRegistry(items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось загрузить реестр DOCchecker");
    } finally {
      setRegistryLoading(false);
    }
  };

  useEffect(() => {
    void loadRegistry();
    void loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePreview = async () => {
    if (!pdfFile) {
      message.warning("Сначала выбери PDF файл");
      return;
    }
    setLoadingPreview(true);
    try {
      const result = await smartUploadPreview(pdfFile);
      setPreview(result);
      setBatchResult(null);
      setProcessingResult(null);
      const values: FieldMap = {};
      for (const key of FIELD_ORDER) {
        const value = result.fields[key];
        if (value !== null && value !== undefined) {
          values[key] = String(value);
        }
      }
      form.setFieldsValue(values);
      message.success("Поля извлечены, проверь и подтверди");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось выполнить предпросмотр");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleProcess = async () => {
    if (!pdfFile) {
      message.warning("Сначала выбери PDF файл");
      return;
    }
    setLoadingProcess(true);
    try {
      const overrides = form.getFieldsValue();
      const result = await smartUploadProcess({
        pdf: pdfFile,
        relatedFiles,
        overrides,
      });
      setProcessingResult(result);
      setBatchResult(null);
      await loadRegistry();
      await loadTree();
      message.success("DOCchecker завершил раскладку файлов");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось обработать файлы");
    } finally {
      setLoadingProcess(false);
    }
  };

  const handleBatchProcess = async () => {
    if (pdfFiles.length === 0) {
      message.warning("Добавь PDF файлы для пакетной обработки");
      return;
    }
    setLoadingBatchProcess(true);
    try {
      const result = await smartUploadProcessBatch(pdfFiles);
      setBatchResult(result);
      setProcessingResult(null);
      setPreview(null);
      form.resetFields();
      await loadRegistry();
      await loadTree();
      message.success(`Пакетная обработка завершена: ${result.processed}/${result.total}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Ошибка пакетной обработки");
    } finally {
      setLoadingBatchProcess(false);
    }
  };

  const pdfList: UploadFile[] = pdfFile
    ? [{ uid: "pdf-1", name: pdfFile.name, status: "done", originFileObj: pdfFile }]
    : [];
  const pdfBatchList: UploadFile[] = pdfFiles.map((file, index) => ({
    uid: `batch-${index}`,
    name: file.name,
    status: "done",
    originFileObj: file,
  }));
  const relatedList: UploadFile[] = relatedFiles.map((file, index) => ({
    uid: `related-${index}`,
    name: file.name,
    status: "done",
    originFileObj: file,
  }));

  const openPdfPreview = async (node: SmartUploadTreeNode) => {
    try {
      const blob = await fetchSmartUploadFileBlob(node.relative_path);
      if (previewPdfUrl) {
        URL.revokeObjectURL(previewPdfUrl);
      }
      const url = URL.createObjectURL(blob);
      setPreviewPdfUrl(url);
      setPreviewPdfTitle(node.name);
      setPreviewModalOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось открыть PDF");
    }
  };

  const closePdfPreview = () => {
    setPreviewModalOpen(false);
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
      setPreviewPdfUrl("");
    }
  };

  const toAntTree = (rows: SmartUploadRegistryItem[]): DataNode[] => {
    type TreeBucket = Map<string, TreeBucket | SmartUploadRegistryItem[]>;
    const root: TreeBucket = new Map();

    const getLevelValue = (
      row: SmartUploadRegistryItem,
      key: HierarchyKey,
    ): string => String(row[key] ?? "—");

    for (const row of rows) {
      let cursor = root;
      for (const level of hierarchyOrder) {
        const value = getLevelValue(row, level);
        if (!cursor.has(value)) {
          cursor.set(value, new Map());
        }
        cursor = cursor.get(value) as TreeBucket;
      }
      if (!cursor.has("__files__")) {
        cursor.set("__files__", []);
      }
      (cursor.get("__files__") as SmartUploadRegistryItem[]).push(row);
    }

    const build = (bucket: TreeBucket, prefix: string): DataNode[] => {
      const nodes: DataNode[] = [];
      for (const [key, value] of bucket.entries()) {
        if (key === "__files__") {
          for (const row of value as SmartUploadRegistryItem[]) {
            nodes.push({
              key: `${prefix}/${row.pdf_relative_path}`,
              title: (
                <Space size={8}>
                  <Typography.Text>{row.pdf_name}</Typography.Text>
                  <Button
                    size="small"
                    type="link"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void openPdfPreview({
                        key: row.pdf_relative_path,
                        name: row.pdf_name,
                        node_type: "file",
                        relative_path: row.pdf_relative_path,
                        is_pdf: true,
                        children: [],
                      });
                    }}
                  >
                    Просмотр PDF
                  </Button>
                </Space>
              ),
              isLeaf: true,
            });
          }
          continue;
        }
        nodes.push({
          key: `${prefix}/${key}`,
          title: key,
          children: build(value as TreeBucket, `${prefix}/${key}`),
        });
      }
      return nodes;
    };
    return build(root, "root");
  };

  const filteredRegistry = useMemo(() => {
    const query = docChatQuery.trim().toLowerCase();
    if (!query) return registry;
    const terms = query.split(/\s+/).filter(Boolean);
    return registry.filter((item) => {
      const source = `${item.full_cipher} ${item.cipher_no_revision} ${item.title_text ?? ""} ${item.project} ${item.document_category} ${item.discipline} ${item.title_code}`.toLowerCase();
      return terms.every((term) => source.includes(term));
    });
  }, [registry, docChatQuery]);

  const moveHierarchyLevel = (index: number, direction: -1 | 1) => {
    setHierarchyOrder((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const temp = next[index];
      next[index] = next[nextIndex];
      next[nextIndex] = temp;
      return next;
    });
  };

  const handleDeleteRegistryItem = async (row: SmartUploadRegistryItem) => {
    if (!row.entry_key) {
      message.error("Нельзя удалить строку: отсутствует ключ записи. Обнови реестр.");
      return;
    }
    try {
      await deleteSmartUploadRegistryItem(row.entry_key);
      message.success(`Удалено: ${row.full_cipher}`);
      await loadRegistry();
      await loadTree();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось удалить документ");
    }
  };

  const startEditRegistryItem = (row: SmartUploadRegistryItem) => {
    setEditingEntryKey(row.entry_key);
    setEditingFields({
      full_cipher: row.full_cipher,
      document_class: row.document_class || "",
      development_date: row.development_date || "",
      issue_purpose: row.issue_purpose || "",
      title_text: row.title_text || "",
    });
  };

  const cancelEditRegistryItem = () => {
    setEditingEntryKey(null);
    setEditingFields({});
  };

  const saveEditRegistryItem = async (row: SmartUploadRegistryItem) => {
    try {
      await updateSmartUploadRegistryItem({
        entry_key: row.entry_key,
        fields: editingFields,
      });
      message.success("Документ обновлен");
      setEditingEntryKey(null);
      setEditingFields({});
      await loadRegistry();
      await loadTree();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    }
  };

  const docChatAnswer = useMemo(() => {
    if (!docChatQuery.trim()) return "Введи запрос: шифр, дисциплина, категория, титул.";
    if (filteredRegistry.length === 0) return "Ничего не найдено. Попробуй упростить запрос.";
    const previewRows = filteredRegistry.slice(0, 3).map((item) => `${item.full_cipher} (rev ${item.revision})`);
    return `Найдено ${filteredRegistry.length} документов. Примеры: ${previewRows.join("; ")}`;
  }, [docChatQuery, filteredRegistry]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="DOCchecker - умная загрузка документов" className="hrp-card">
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Typography.Text strong>Пакетная загрузка PDF (много документов сразу)</Typography.Text>
          <Upload.Dragger
            accept=".pdf"
            multiple
            fileList={pdfBatchList}
            beforeUpload={(file) => {
              setPdfFiles((prev) => [...prev, file]);
              return false;
            }}
            onRemove={(file) => {
              setPdfFiles((prev) => prev.filter((item) => item.name !== file.name));
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Пакетная загрузка: перетащи сразу много PDF</p>
          </Upload.Dragger>
          <Button type="primary" loading={loadingBatchProcess} onClick={handleBatchProcess}>
            Обработать пакет PDF
          </Button>

          <Typography.Text strong>Одиночная загрузка PDF + связанные файлы</Typography.Text>
          <Upload.Dragger
            accept=".pdf"
            maxCount={1}
            fileList={pdfList}
            beforeUpload={(file) => {
              setPdfFile(file);
              return false;
            }}
            onRemove={() => {
              setPdfFile(null);
              setPreview(null);
              setProcessingResult(null);
              setBatchResult(null);
              form.resetFields();
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Перетащи PDF сюда или нажми для выбора</p>
            <p className="ant-upload-hint">Из этого файла DOCchecker извлечет шифр и поля документа</p>
          </Upload.Dragger>

          <Upload
            multiple
            fileList={relatedList}
            beforeUpload={(file) => {
              setRelatedFiles((prev) => [...prev, file]);
              return false;
            }}
            onRemove={(file) => {
              setRelatedFiles((prev) => prev.filter((item) => item.name !== file.name));
            }}
          >
            <Button>Добавить связанные файлы (DOCX/XLSX/DWG/...)</Button>
          </Upload>

          <Space>
            <Button type="default" loading={loadingPreview} onClick={handlePreview}>
              Предпросмотр шифра
            </Button>
            <Button type="primary" loading={loadingProcess} onClick={handleProcess}>
              Подтвердить и разложить
            </Button>
          </Space>
        </Space>
      </Card>

      {preview && (
        <Card title="Распознанные поля" className="hrp-card">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type={preview.requires_confirmation ? "warning" : "success"}
              message={
                preview.requires_confirmation
                  ? "Нужна проверка: отредактируй поля перед сохранением"
                  : "Поля распознаны уверенно"
              }
              description={`Источник: ${preview.source}. Confidence: ${preview.confidence.toFixed(2)}. Иерархия: ${preview.suggested_hierarchy}`}
            />
            <Form layout="vertical" form={form}>
              <Row gutter={[12, 0]}>
                {FIELD_ORDER.map((key) => (
                  <Col span={8} key={key}>
                    <Form.Item name={key} label={FIELD_LABELS[key] ?? key}>
                      <Input />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </Form>
          </Space>
        </Card>
      )}

      {processingResult && (
        <Card title="Результат обработки" className="hrp-card">
          <Space direction="vertical" size={8}>
            <Typography.Text>
              <strong>Иерархия:</strong> {processingResult.hierarchy}
            </Typography.Text>
            <Typography.Text>
              <strong>Путь:</strong> {processingResult.destination}
            </Typography.Text>
            <Typography.Text>
              <strong>PDF:</strong> {processingResult.pdf_path}
            </Typography.Text>
            <Typography.Text>
              <strong>Связанные файлы:</strong> {processingResult.related_paths.length || 0}
            </Typography.Text>
          </Space>
        </Card>
      )}

      {batchResult && (
        <Card title="Результат пакетной обработки" className="hrp-card">
          <Typography.Text>
            Обработано {batchResult.processed} из {batchResult.total}
          </Typography.Text>
        </Card>
      )}

      <Card
        title="Дерево иерархии документов"
        className="hrp-card"
        extra={
          <Space>
            <Space size={4} wrap>
              {hierarchyOrder.map((level, index) => (
                <Space key={level} size={4}>
                  <Typography.Text>{hierarchyLabels[level]}</Typography.Text>
                  <Button
                    size="small"
                    icon={<LeftOutlined />}
                    onClick={() => moveHierarchyLevel(index, -1)}
                    disabled={index === 0}
                  />
                  <Button
                    size="small"
                    icon={<RightOutlined />}
                    onClick={() => moveHierarchyLevel(index, 1)}
                    disabled={index === hierarchyOrder.length - 1}
                  />
                </Space>
              ))}
            </Space>
            <Button loading={treeLoading} onClick={() => void loadTree()}>
              Обновить
            </Button>
          </Space>
        }
      >
        <Tree treeData={toAntTree(filteredRegistry)} defaultExpandAll />
      </Card>

      <Card
        title="Реестр документов DOCchecker"
        className="hrp-card"
        extra={
          <Button loading={registryLoading} onClick={() => void loadRegistry()}>
            Обновить реестр
          </Button>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Input.TextArea
            value={docChatQuery}
            onChange={(event) => setDocChatQuery(event.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="Чат по документам: например 'найди IMP FD IN ревизия 00'"
          />
          <Alert type="info" message="DOCchecker chat" description={docChatAnswer} />
          <Table<SmartUploadRegistryItem>
            rowKey={(row) => `${row.full_cipher}-${row.revision}-${row.pdf_name}`}
            loading={registryLoading}
            dataSource={filteredRegistry}
            pagination={{ pageSize: 8 }}
            size="small"
            columns={[
              { title: "Проект", dataIndex: "project", width: 80 },
              { title: "Категория", dataIndex: "document_category", width: 110 },
              {
                title: "Класс",
                dataIndex: "document_class",
                width: 90,
                render: (_, row) =>
                  editingEntryKey === row.entry_key ? (
                    <Input
                      value={editingFields.document_class ?? ""}
                      onChange={(event) =>
                        setEditingFields((prev) => ({ ...prev, document_class: event.target.value }))
                      }
                    />
                  ) : (
                    row.document_class || "—"
                  ),
              },
              { title: "Дисц.", dataIndex: "discipline", width: 90 },
              { title: "Титул", dataIndex: "title_code", width: 90 },
              { title: "Шифр без рев.", dataIndex: "cipher_no_revision", width: 260 },
              { title: "Рев.", dataIndex: "revision", width: 70 },
              {
                title: "Полный шифр",
                dataIndex: "full_cipher",
                width: 260,
                render: (_, row) =>
                  editingEntryKey === row.entry_key ? (
                    <Input
                      value={editingFields.full_cipher ?? ""}
                      onChange={(event) =>
                        setEditingFields((prev) => ({ ...prev, full_cipher: event.target.value }))
                      }
                    />
                  ) : (
                    row.full_cipher
                  ),
              },
              {
                title: "Дата разработки",
                dataIndex: "development_date",
                width: 140,
                render: (_, row) =>
                  editingEntryKey === row.entry_key ? (
                    <Input
                      placeholder="YYYY-MM-DD"
                      value={editingFields.development_date ?? ""}
                      onChange={(event) =>
                        setEditingFields((prev) => ({ ...prev, development_date: event.target.value }))
                      }
                    />
                  ) : (
                    row.development_date || "—"
                  ),
              },
              {
                title: "Цель выпуска",
                dataIndex: "issue_purpose",
                width: 140,
                render: (_, row) =>
                  editingEntryKey === row.entry_key ? (
                    <Input
                      value={editingFields.issue_purpose ?? ""}
                      onChange={(event) =>
                        setEditingFields((prev) => ({ ...prev, issue_purpose: event.target.value }))
                      }
                    />
                  ) : (
                    row.issue_purpose || "—"
                  ),
              },
              {
                title: "Название",
                dataIndex: "title_text",
                width: 240,
                ellipsis: true,
                render: (_, row) =>
                  editingEntryKey === row.entry_key ? (
                    <Input
                      value={editingFields.title_text ?? ""}
                      onChange={(event) =>
                        setEditingFields((prev) => ({ ...prev, title_text: event.target.value }))
                      }
                    />
                  ) : (
                    row.title_text || "—"
                  ),
              },
              {
                title: "PDF",
                key: "pdf_preview",
                width: 270,
                render: (_, row) => (
                  <Space>
                    <Button
                      type="link"
                      size="small"
                      onClick={() =>
                        void openPdfPreview({
                          key: row.pdf_relative_path,
                          name: row.pdf_name,
                          node_type: "file",
                          relative_path: row.pdf_relative_path,
                          is_pdf: true,
                          children: [],
                        })
                      }
                    >
                      Открыть
                    </Button>
                    <Popconfirm
                      disabled={!row.entry_key}
                      title="Удалить документ?"
                      description="Будет удалена запись и файлы этой ревизии из DOCchecker."
                      okText="Удалить"
                      cancelText="Отмена"
                      onConfirm={() => void handleDeleteRegistryItem(row)}
                    >
                      <Button type="link" danger size="small">
                        Удалить
                      </Button>
                    </Popconfirm>
                    {editingEntryKey === row.entry_key ? (
                      <>
                        <Button type="link" size="small" onClick={() => void saveEditRegistryItem(row)}>
                          Сохранить
                        </Button>
                        <Button type="link" size="small" onClick={cancelEditRegistryItem}>
                          Отмена
                        </Button>
                      </>
                    ) : (
                      <Button type="link" size="small" onClick={() => startEditRegistryItem(row)}>
                        Редактировать
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
            scroll={{ x: 1700 }}
          />
        </Space>
      </Card>

      <Modal
        title={previewPdfTitle || "Просмотр PDF"}
        open={previewModalOpen}
        onCancel={closePdfPreview}
        footer={null}
        width={1000}
        destroyOnHidden
      >
        {previewPdfUrl ? (
          <iframe
            src={previewPdfUrl}
            title={previewPdfTitle || "PDF preview"}
            style={{ width: "100%", height: "75vh", border: 0 }}
          />
        ) : null}
      </Modal>
    </Space>
  );
}
