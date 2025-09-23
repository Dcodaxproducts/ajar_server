import { Schema, model, Document } from "mongoose";

export interface ILanguageTranslation {
  locale: string;
  translations: {
    name?: string;
    label?: string;
    placeholder?: string;
  };
}

// NEW: document-specific interface
export interface IDocumentField {
  requiresExpiry?: boolean; // whether expiryDate is required
  requiresImage?: boolean; // whether image upload is required
}

export interface IField extends Document {
  name: string;
  type?: string; // e.g. "text", "number", "document"
  placeholder?: string;
  label?: string;
  isMultiple?: boolean;
  options?: string[];
  order?: number;
  tooltip?: string;
  visible?: boolean;
  defaultValue?: string | number | boolean;
  readonly?: boolean;
  validation?: {
    required: boolean;
    pattern?: string;
    min?: number;
    max?: number;
  };
  min?: number;
  max?: number;
  language?: string;
  languages?: ILanguageTranslation[];

  // NEW: for "document" type fields
  documentConfig?: IDocumentField;
}

const FieldSchema = new Schema<IField>(

    {
    name: { type: String, required: true },
    type: { type: String, required: true },
    placeholder: { type: String, required: true },
    label: { type: String, required: true },
    isMultiple: { type: Boolean, default: false },
    options: { type: [String], default: undefined },
    order: { type: Number, default: 0 },
    tooltip: { type: String },
    visible: { type: Boolean, default: true },
    defaultValue: { type: Schema.Types.Mixed },
    readonly: { type: Boolean, default: false },
    validation: {
      required: { type: Boolean, default: false },
      pattern: { type: String },
      min: { type: Number },
      max: { type: Number },
    },
    min: { type: Number },
    max: { type: Number },
    language: { type: String, default: "en" },
    languages: [
      {
        locale: { type: String, required: true },
        translations: {
          name: { type: String },
          label: { type: String },
          placeholder: { type: String },
        },
      },
    ],
 

    // ✅ documentConfig supports multiple documents
    documentConfig: [
      {
        name: { type: String, required: true },
        requiresExpiry: { type: Boolean, default: false },
        requiresImage: { type: Boolean, default: true },
      },
    ],
  },
  { timestamps: true }
  // {
  //   name: { type: String, required: true },
  //   type: { type: String, required: true }, // "document" supported now
  //   placeholder: { type: String, required: true },
  //   label: { type: String, required: true },
  //   isMultiple: { type: Boolean, default: false },
  //   options: { type: [String], default: undefined },
  //   order: { type: Number, default: 0 },
  //   tooltip: { type: String },
  //   visible: { type: Boolean, default: true },
  //   defaultValue: { type: Schema.Types.Mixed },
  //   readonly: { type: Boolean, default: false },
  //   validation: {
  //     required: { type: Boolean, default: false },
  //     pattern: { type: String },
  //     min: { type: Number },
  //     max: { type: Number },
  //   },
  //   min: { type: Number },
  //   max: { type: Number },
  //   language: { type: String, default: "en" },
  //   languages: [
  //     {
  //       locale: { type: String, required: true },
  //       translations: {
  //         name: { type: String },
  //         label: { type: String },
  //         placeholder: { type: String },
  //       },
  //     },
  //   ],

  //   // NEW: only relevant if type === "document"
  //   documentConfig: {
  //     requiresExpiry: { type: Boolean, default: false },
  //     requiresImage: { type: Boolean, default: true },
  //   },
  // },
  // { timestamps: true }
);

export const Field = model<IField>("Field", FieldSchema);








// import { Schema, model, Document } from "mongoose";

// export interface ILanguageTranslation {
//   locale: string;
//   translations: {
//     name?: string;
//     label?: string;
//     placeholder?: string;
//   };
// }

// export interface IField extends Document {
//   name: string;
//   type?: string;
//   placeholder?: string;
//   label?: string;
//   isMultiple?: boolean;
//   options?: string[];
//   order?: number;
//   tooltip?: string;
//   visible?: boolean;
//   defaultValue?: string | number | boolean;
//   readonly?: boolean;
//   validation?: {
//     required: boolean;
//     pattern?: string;
//     min?: number;
//     max?: number;
//   };
//   min?: number;
//   max?: number;
//   language?: string;
//   languages?: ILanguageTranslation[];
// }

// const FieldSchema = new Schema<IField>(
//   {
//     name: { type: String, required: true },
//     type: { type: String, required: true },
//     placeholder: { type: String, required: true },
//     label: { type: String, required: true },
//     isMultiple: { type: Boolean, default: false },
//     options: { type: [String], default: undefined },
//     order: { type: Number, default: 0 },
//     tooltip: { type: String },
//     visible: { type: Boolean, default: true },
//     defaultValue: { type: Schema.Types.Mixed },
//     readonly: { type: Boolean, default: false },
//     validation: {
//       required: { type: Boolean, default: false },
//       pattern: { type: String },
//       min: { type: Number },
//       max: { type: Number },
//     },
//     min: { type: Number },
//     max: { type: Number },
//     language: { type: String, default: "en" },
//     languages: [
//       {
//         locale: { type: String, required: true },
//         translations: {
//           name: { type: String },
//           label: { type: String },
//           placeholder: { type: String },
//         },
//       },
//     ],
//   },
//   { timestamps: true }
// );

// export const Field = model<IField>("Field", FieldSchema);
