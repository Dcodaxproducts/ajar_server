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
      console.log(`Missing or empty document: ${docName}`);
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



