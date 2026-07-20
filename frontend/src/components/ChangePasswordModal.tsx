import { Form, Input, Modal, message } from "antd";
import { useState } from "react";

import { changeMyPassword } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Самостоятельная смена пароля — доступна любой роли по клику на карточку
// пользователя в сайдбаре. Роли и права здесь не редактируются (только админ,
// через Администрирование).
export default function ChangePasswordModal({ open, onClose }: Props): JSX.Element {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await changeMyPassword(values.current_password, values.new_password);
      message.success("Пароль изменён");
      form.resetFields();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось сменить пароль");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Сменить пароль"
      okText="Сменить"
      cancelText="Отмена"
      onOk={submit}
      okButtonProps={{ loading: submitting }}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="current_password"
          label="Текущий пароль"
          rules={[{ required: true, message: "Введите текущий пароль" }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="new_password"
          label="Новый пароль (минимум 6 символов)"
          rules={[
            { required: true, message: "Введите новый пароль" },
            { min: 6, message: "Минимум 6 символов" },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm_password"
          label="Повторите новый пароль"
          dependencies={["new_password"]}
          rules={[
            { required: true, message: "Повторите пароль" },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || value === getFieldValue("new_password")
                  ? Promise.resolve()
                  : Promise.reject(new Error("Пароли не совпадают")),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
