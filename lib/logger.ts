const isProduction = process.env.NODE_ENV === "production";

const formatMessage = (message: string, data?: unknown): string => {
  if (data === undefined) return message;
  try {
    return `${message} ${JSON.stringify(data)}`;
  } catch {
    return message;
  }
};

export const logger = {
  info: (message: string, data?: unknown) => {
    if (!isProduction) console.log(formatMessage(message, data));
  },
  warn: (message: string, data?: unknown) => {
    console.warn(formatMessage(message, data));
  },
  error: (message: string, data?: unknown) => {
    console.error(formatMessage(message, data));
  },
  debug: (message: string, data?: unknown) => {
    if (!isProduction) console.debug(formatMessage(message, data));
  },
};