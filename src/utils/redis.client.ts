import Redis from "ioredis";

class RedisClient {
  private static instance: Redis;

  private constructor() {}

  public static getInstance(): Redis {
    if (!RedisClient.instance) {
      RedisClient.instance = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        keepAlive: 1,
        maxRetriesPerRequest: 2,
        reconnectOnError: (err) => {
          console.error("❌ Redis Connection Error:", err);
          return true;
        },
      });

      RedisClient.instance.on("connect", () =>
        console.log("✅ Redis Connected")
      );
      RedisClient.instance.on("error", (err) =>
        console.error("❌ Redis Error:", err)
      );
    }

    return RedisClient.instance;
  }
}

// Export a single Redis instance
export const redis = RedisClient.getInstance();
