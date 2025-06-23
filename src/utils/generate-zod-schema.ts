import { z } from "zod";

export const generateZodSchema = (fields: any[]) => {
  const schemaShape: Record<string, any> = {};

  fields.forEach((field) => {
    let fieldSchema;

    switch (field.type) {
      case "text":
      case "email":
      case "password":
        fieldSchema = z.string({
          required_error: `${field.title} is required`,
        });

        if (field.type === "email")
          fieldSchema = fieldSchema.email({ message: "Invalid email format" });

        if (field.type === "password")
          fieldSchema = fieldSchema
            .min(6, { message: "Password must be at least 6 characters" })
            .max(20, { message: "Password must be less than 20 characters" });

        break;

      case "number":
        fieldSchema = z
          .number({
            required_error: `${field.title} is required`,
            invalid_type_error: `${field.title} must be a number`,
          })
          .min(1, { message: `${field.title} must be greater than 0` });

        break;

      case "checkbox":
        fieldSchema = z
          .array(z.enum(field.options || []))
          .min(1, { message: `At least one ${field.title} must be selected` });

        break;

      case "radio":
        fieldSchema = z.enum(field.options || [], {
          required_error: `Please select a ${field.title}`,
        });

        break;

      case "select":
        fieldSchema = z.enum(field.options || [], {
          required_error: `Please select a ${field.title}`,
        });

        break;

      case "date":
        fieldSchema = z.string().refine((val) => !isNaN(Date.parse(val)), {
          message: `${field.title} must be a valid date`,
        });

        break;

      case "file":
        fieldSchema = z
          .instanceof(File, { message: `Invalid file type for ${field.title}` })
          .optional();

        break;

      case "boolean":
        fieldSchema = z.boolean({
          required_error: `${field.title} is required`,
        });

        break;

      case "textarea":
        fieldSchema = z.string().min(5, {
          message: `${field.title} must be at least 5 characters long`,
        });

        break;

      default:
        fieldSchema = z.any();
    }

    if (!field.required) {
      fieldSchema = fieldSchema.optional();
    }

    schemaShape[field.title] = fieldSchema;
  });

  return z.object(schemaShape);
};
