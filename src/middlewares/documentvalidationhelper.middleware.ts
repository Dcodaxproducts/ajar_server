// middlewares/documentvalidationhelper.middleware.ts
interface DocumentCheckResult {
  valid: boolean;
  message: string;
  missingDocuments?: string[];
}

export const validateDocuments = async (
  documents: any[],
  requiredDocs: string[]
): Promise<DocumentCheckResult> => {
  const missingDocuments: string[] = [];

  for (const docName of requiredDocs) {
    const doc = documents.find(
      (d) => d.name.toLowerCase() === docName.toLowerCase()
    );
    if (!doc || !doc.filesUrl || doc.filesUrl.length === 0) {
      console.log(`❌ Missing or empty document: ${docName}`);
      missingDocuments.push(docName);
    }
  }

  if (missingDocuments.length > 0) {
    return {
      valid: false,
      message: `Missing required document(s): ${missingDocuments.join(", ")}`,
      missingDocuments,
    };
  }

  return { valid: true, message: "All documents are valid" };
};









// import { Dropdown } from "../models/dropdown.model";
// import { User } from "../models/user.model"; // assuming you have this


// interface DocumentCheckResult {
//   valid: boolean;
//   message: string;
//   missingDocuments?: string[]; // new field for missing dropdowns
// }

// export const validateDocuments = async (
//   type: string,
//   documents: any[]
// ): Promise<DocumentCheckResult> => {
//   // For example, required dropdowns for listing
//   const requiredDropdowns = type === "listing" ? ["property_paper", "ownership_doc"] : [];

//   const missingDocuments: string[] = [];

//   for (const docName of requiredDropdowns) {
//     const doc = documents.find(
//       (d) => d.name.toLowerCase() === docName.toLowerCase()
//     );
//     if (!doc || !doc.filesUrl || doc.filesUrl.length === 0) {
//       console.log(`❌ Missing or empty dropdown document: ${docName}`);
//       missingDocuments.push(docName);
//     }
//   }

//   if (missingDocuments.length > 0) {
//     return {
//       valid: false,
//       message: `Missing document dropdown(s): ${missingDocuments.join(", ")}`,
//       missingDocuments,
//     };
//   }

//   return { valid: true, message: "All documents are valid" };
// };
