import nodemailer from "nodemailer";

const createNodeMailerTransporter = async () => {
  const config = {
    mailerName: "hostdonor",
    host: "mail.hostdonor.com",
    port: 465,
    secure: true,
    email: "info@hostdonor.com",
    password: "qwerty@1122",
  };

  try {
    if (!config) {
      throw new Error("Mail configuration is not available.");
    }
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.email,
        pass: config.password,
      },
      //   logger: true,
      //   debug: true,
    });
    return transporter;
  } catch (error) {
    console.error("Failed to create mail transporter:", error);
    throw error;
  }
};

export const sendEmail = async ({
  to,
  name,
  subject,
  content,
}: {
  to: string;
  name: string;
  subject: string;
  content: string;
}) => {
  console.log({ to });
  try {
    const transporter = await createNodeMailerTransporter();

    const htmlTemplate = `
      <html>
      <body style="font-family: Arial, sans-serif;">
        <div style="max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          ${content}
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"AJAR" <info@hostdonor.com>`,
      to: to,
      subject: subject,
      html: htmlTemplate,
    };

    const info = await transporter.sendMail(mailOptions);
    return info.response;
  } catch (error) {
    console.error("Error sending email:", error);
    return (error as any).response;
  }
};
