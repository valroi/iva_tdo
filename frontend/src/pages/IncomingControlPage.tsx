import { Alert, Button, Card, Input, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { listTransmittals, submitIncomingCheck } from "../api";
import type { IncomingDecision, Transmittal, User } from "../types";

interface Props {
  currentUser: User;
  onReloadAll: () => Promise<void>;
}

export default function IncomingControlPage({ currentUser, onReloadAll }: Props): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [transmittals, setTransmittals] = useState<Transmittal[]>([]);
  const [reasonById, setReasonById] = useState<Record<number, string>>({});
  const canIncomingControl = useMemo(
    () => ["admin", "owner_manager", "owner_reviewer"].includes(currentUser.role),
    [currentUser.role],
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await listTransmittals();
      setTransmittals(data);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Ошибка загрузки входного контроля";
      message.error(text);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const queue = useMemo(
    () => transmittals.filter((item) => item.status === "SENT" || item.status === "INCOMING_REJECTED"),
    [transmittals],
  );

  const processDecision = async (transmittalId: number, decision: IncomingDecision) => {
    try {
      await submitIncomingCheck(transmittalId, {
        decision,
        reason: reasonById[transmittalId] ?? undefined,
      });
      message.success(`TRM ${decision === "ACCEPT" ? "принят" : "отклонен"} на входном контроле`);
      await Promise.all([loadData(), onReloadAll()]);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Ошибка обработки входного контроля";
      message.error(text);
    }
  };

  const columns: ColumnsType<Transmittal> = [
    { title: "TRM", dataIndex: "trm_number", key: "trm_number" },
    { title: "Цель выпуска", dataIndex: "issue_purpose", key: "issue_purpose" },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      render: (value: Transmittal["status"]) => {
        const colorMap: Record<Transmittal["status"], string> = {
          DRAFT: "default",
          SENT: "processing",
          INCOMING_ACCEPTED: "success",
          INCOMING_REJECTED: "error",
        };
        return <Tag color={colorMap[value]}>{value}</Tag>;
      },
    },
    {
      title: "Причина/комментарий",
      key: "reason",
      render: (_, row) => (
        <Input
          placeholder="Причина для reject / комментарий"
          value={reasonById[row.id] ?? ""}
          onChange={(event) =>
            setReasonById((prev) => ({
              ...prev,
              [row.id]: event.target.value,
            }))
          }
        />
      ),
    },
    {
      title: "Решение",
      key: "actions",
      render: (_, row) => (
        <Space>
          <Button type="primary" onClick={() => void processDecision(row.id, "ACCEPT")}>
            Accept
          </Button>
          <Button danger onClick={() => void processDecision(row.id, "REJECT")}>
            Reject
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Входной контроль
        </Typography.Title>
        <Button onClick={() => void loadData()}>Обновить</Button>
      </Space>
      {!canIncomingControl && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Только роли Owner/Admin могут выполнять входной контроль"
        />
      )}

      <Table rowKey="id" loading={loading} columns={columns} dataSource={queue} />
    </Card>
  );
}
