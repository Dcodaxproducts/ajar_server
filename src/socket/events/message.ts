import { Server as SocketIOServer, Socket } from "socket.io";
import { UserSocketHelpers } from "../index";
import { Conversation } from "../../models/conversation.model";
import { Message } from "../../models/message.model";

const registerMessageEvents = (
  io: SocketIOServer,
  socket: Socket,
  userId: string,
  helpers: UserSocketHelpers
) => {
  // Track which chats each user is actively viewing
  const activeChats = new Map<string, Set<string>>(); // userId -> Set of chatIds

  // Helper to check if user is actively viewing a specific chat
  const isUserViewingChat = (userId: string, chatId: string): boolean => {
    return activeChats.get(userId)?.has(chatId) || false;
  };



   // CHANGED: Helper to send unread count for a chat
  const emitUnreadCount = async (receiverId: string, chatId: string) => {
    const count = await Message.countDocuments({
      chatId,
      receiver: receiverId,
      seen: false,
    });
    helpers.getIO().to(`user:${receiverId}`).emit("chat:unreadCount", {
      chatId,
      unreadCount: count,
    });
  };



  // User joins a chat (actively viewing it)
  socket.on("chat:join", (data: { chatId: string }) => {
    if (!activeChats.has(userId)) {
      activeChats.set(userId, new Set());
    }
    activeChats.get(userId)!.add(data.chatId);
    console.log(`User ${userId} joined chat ${data.chatId}`);

    // Mark all messages in this chat as delivered and read
    markMessagesAsDeliveredAndRead(userId, data.chatId, helpers);
  });

  // User leaves a chat (no longer viewing it)
  socket.on("chat:leave", (data: { chatId: string }) => {
    if (activeChats.has(userId)) {
      activeChats.get(userId)!.delete(data.chatId);
      console.log(`User ${userId} left chat ${data.chatId}`);
    }
  });

  // Mark messages as delivered and read when user joins a chat
  const markMessagesAsDeliveredAndRead = async (
    userId: string,
    chatId: string,
    helpers: UserSocketHelpers
  ) => {
    try {
      // Mark all undelivered messages in this chat as delivered
      const undeliveredMessages = await Message.find({
        chatId,
        receiver: userId,
        deliveredAt: null,
      }).populate("sender");

      const deliveredAt = new Date();
      for (const message of undeliveredMessages) {
        message.deliveredAt = deliveredAt;
        await message.save();

        // Notify sender that message was delivered
        helpers
          .getIO()
          .to(`user:${message.sender._id}`)
          .emit("message:delivered", {
            messageId: message._id,
            deliveredAt,
          });
      }

      // Mark all delivered but unread messages in this chat as read
      const unreadMessages = await Message.find({
        chatId,
        receiver: userId,
        deliveredAt: { $ne: null },
        readAt: null,
      }).populate("sender");

      const readAt = new Date();

        //COUNT READ MESSAGES
      let readCount = 0;


      for (const message of unreadMessages) {
        message.readAt = readAt;
        message.seen = true; // CHANGED: mark as seen
        await message.save();

         readCount++; // increase count

        // Notify sender that message was read
        helpers.getIO().to(`user:${message.sender._id}`).emit("message:read", {
          messageId: message._id,
          readAt,
        });
      }

      // CHANGED: Emit updated unread count
      emitUnreadCount(userId, chatId);

      //Final log
    if (readCount > 0) {
      console.log(`User ${userId} read ${readCount} messages in chat ${chatId}`);
    }

    } catch (error) {
      console.error("Error marking messages as delivered/read:", error);
    }
  };

  socket.on(
    "message:send",
    async (data: { text: string; chatId: string; receiver: string;  attachments?: string[]; }) => {
      console.log("Message send event received:", data);
      try {
        const { text, chatId, receiver, attachments  } = data;

        // Create message in database
        const message = new Message({
          chatId,
          sender: userId,
          text,
          receiver,
          attachments: attachments || [],
          seen: false, // CHANGED: ensure new message is unseen
        });

        await message.save();
        await message.populate("sender receiver");

        // Update chat's last message
        await Conversation.findByIdAndUpdate(chatId, {
          lastMessage: message._id,
          updatedAt: new Date(),
        });

        // Find receiver ID
        const receiverId = message.receiver._id.toString();

        // Send the new message to the SENDER
        socket.emit("message:sent", message);

        // Send to RECEIVER
        helpers
          .getIO()
          .to(`user:${receiverId}`)
          .emit("message:received", message);


           // CHANGED: Emit updated unread count for receiver
        emitUnreadCount(receiverId, chatId);


        // If receiver is online AND viewing this chat, mark as delivered immediately
        if (
          helpers.isUserOnline(receiverId) &&
          isUserViewingChat(receiverId, chatId)
        ) {
          message.deliveredAt = new Date();
          message.readAt = new Date();
          message.seen = true; // mark as seen
          await message.save();

          // Notify sender that message was delivered
          socket.emit("message:delivered", {
            messageId: message._id,
            deliveredAt: message.deliveredAt,
          });

          // Also mark as read if user is actively viewing the chat
          message.readAt = new Date();
          await message.save();

          // Notify sender that message was read
          socket.emit("message:read", {
            messageId: message._id,
            readAt: message.readAt,
          });


          // Update unread count
          emitUnreadCount(receiverId, chatId);


        }
        // If receiver is online but NOT viewing this chat, only mark as delivered
        else if (helpers.isUserOnline(receiverId)) {
          message.deliveredAt = new Date();
          await message.save();

          // Notify sender that message was delivered
          socket.emit("message:delivered", {
            messageId: message._id,
            deliveredAt: message.deliveredAt,
          });
        }
      } catch (error) {
        console.error("Error sending message:", error);
        socket.emit("message:error", {
          error: "Failed to send message",
        });
      }
    }
  );

  // Mark specific message as delivered (when receiver sees the message)
  socket.on("message:deliver", async (data: { messageId: string }) => {
    try {
      const message = await Message.findById(data.messageId);

      if (
        message &&
        message.receiver.toString() === userId &&
        !message.deliveredAt
      ) {
        message.deliveredAt = new Date();
        await message.save();

        // Notify sender that message was delivered
        helpers.getIO().to(`user:${message.sender}`).emit("message:delivered", {
          messageId: message._id,
          deliveredAt: message.deliveredAt,
        });
      }
    } catch (error) {
      console.error("Error marking message as delivered:", error);
    }
  });

  // Mark specific message as read (when receiver opens/reads the message)
  socket.on("message:read", async (data: { messageId: string }) => {
    try {
      const message = await Message.findById(data.messageId);

      if (
        message &&
        message.receiver.toString() === userId &&
        !message.readAt
      ) {
        message.readAt = new Date();
        message.seen = true; // CHANGED: mark message as seen
        await message.save();

        // Notify sender that message was read
        helpers.getIO().to(`user:${message.sender}`).emit("message:read", {
          messageId: message._id,
          readAt: message.readAt,
        });

          // CHANGED: Update unread count for this chat
        emitUnreadCount(userId, message.chatId.toString());

      }
    } catch (error) {
      console.error("Error marking message as read:", error);
    }
  });

  // Clean up active chats on disconnect
  socket.on("disconnect", () => {
    activeChats.delete(userId);
  });
};

export default registerMessageEvents;








// import { Server as SocketIOServer, Socket } from "socket.io";
// import { UserSocketHelpers } from "../index";
// import { Conversation } from "../../models/conversation.model";
// import { Message } from "../../models/message.model";

// const registerMessageEvents = (
// io: SocketIOServer,
// socket: Socket,
// userId: string,
// helpers: UserSocketHelpers
// ) => {
// // Track which chats each user is actively viewing
// const activeChats = new Map<string, Set<string>>(); // userId -> Set of chatIds

// // Helper to check if user is actively viewing a specific chat
// const isUserViewingChat = (userId: string, chatId: string): boolean => {
// return activeChats.get(userId)?.has(chatId) || false;
// };

// // Helper to send unread count for a chat
// const emitUnreadCount = async (receiverId: string, chatId: string) => {
// const count = await Message.countDocuments({
// chatId,
// receiver: receiverId,
// seen: false,
// });
// helpers.getIO().to(`user:${receiverId}`).emit("chat:unreadCount", {
// chatId,
// unreadCount: count,
// });
// };

// // User joins a chat (actively viewing it)
// socket.on("chat:join", (data: { chatId: string }) => {
// if (!activeChats.has(userId)) {
// activeChats.set(userId, new Set());
// }
// activeChats.get(userId)!.add(data.chatId);
// console.log(`User ${userId} joined chat ${data.chatId}`);


// // Mark all messages in this chat as delivered and read  
// markMessagesAsDeliveredAndRead(userId, data.chatId, helpers);  


// });

// // User leaves a chat (no longer viewing it)
// socket.on("chat:leave", (data: { chatId: string }) => {
// if (activeChats.has(userId)) {
// activeChats.get(userId)!.delete(data.chatId);
// console.log(`User ${userId} left chat ${data.chatId}`);
// }
// });

// // Mark messages as delivered and read when user joins a chat
// const markMessagesAsDeliveredAndRead = async (
// userId: string,
// chatId: string,
// helpers: UserSocketHelpers
// ) => {
// try {
// // Mark all undelivered messages in this chat as delivered
// const undeliveredMessages = await Message.find({
// chatId,
// receiver: userId,
// deliveredAt: null,
// }).populate("sender");


//   const deliveredAt = new Date();  
//   for (const message of undeliveredMessages) {  
//     message.deliveredAt = deliveredAt;  
//     await message.save();  

//     // Notify sender that message was delivered  
//     helpers  
//       .getIO()  
//       .to(`user:${message.sender._id}`)  
//       .emit("message:delivered", {  
//         messageId: message._id,  
//         deliveredAt,  
//       });  
//   }  

//   // Mark all delivered but unread messages in this chat as read  
//   const unreadMessages = await Message.find({  
//     chatId,  
//     receiver: userId,  
//     deliveredAt: { $ne: null },  
//     readAt: null,  
//   }).populate("sender");  

//   const readAt = new Date();  
//   let readCount = 0;  

//   for (const message of unreadMessages) {  
//     message.readAt = readAt;  
//     message.seen = true; // mark as seen  
//     await message.save();  
//     readCount++;  

//     // Notify sender that message was read  
//     helpers.getIO().to(`user:${message.sender._id}`).emit("message:read", {  
//       messageId: message._id,  
//       readAt,  
//     });  
//   }  

//   // Emit updated unread count  
//   emitUnreadCount(userId, chatId);  

//   if (readCount > 0) {  
//     console.log(`User ${userId} read ${readCount} messages in chat ${chatId}`);  
//   }  
// } catch (error) {  
//   console.error("Error marking messages as delivered/read:", error);  
// }  


// };

// // Send a new message
// socket.on("message:send", async (data: { text: string; chatId: string; receiver: string; attachments?: string[] }) => {
// console.log("Message send event received:", data);
// try {
// const { text, chatId, receiver, attachments } = data;


//   const message = new Message({  
//     chatId,  
//     sender: userId,  
//     text,  
//     receiver,  
//     attachments: attachments || [],  
//     seen: false, // unseen by default  
//   });  

//   await message.save();  
//   await message.populate("sender receiver");  

//   await Conversation.findByIdAndUpdate(chatId, {  
//     lastMessage: message._id,  
//     updatedAt: new Date(),  
//   });  

//   const receiverId = message.receiver._id.toString();  

//   // Emit to sender  
//   socket.emit("message:sent", message);  

//   // Emit to receiver  
//   helpers.getIO().to(`user:${receiverId}`).emit("message:received", message);  

//   // Update unread count for receiver  
//   emitUnreadCount(receiverId, chatId);  

//   // Delivery/read logic  
//   if (helpers.isUserOnline(receiverId) && isUserViewingChat(receiverId, chatId)) {  
//     message.deliveredAt = new Date();  
//     message.readAt = new Date();  
//     message.seen = true;  
//     await message.save();  

//     socket.emit("message:delivered", { messageId: message._id, deliveredAt: message.deliveredAt });  
//     socket.emit("message:read", { messageId: message._id, readAt: message.readAt });  
//     emitUnreadCount(receiverId, chatId);  
//   } else if (helpers.isUserOnline(receiverId)) {  
//     message.deliveredAt = new Date();  
//     await message.save();  
//     socket.emit("message:delivered", { messageId: message._id, deliveredAt: message.deliveredAt });  
//   }  
// } catch (error) {  
//   console.error("Error sending message:", error);  
//   socket.emit("message:error", { error: "Failed to send message" });  
// }  


// });

// // Mark specific message as delivered
// socket.on("message:deliver", async (data: { messageId: string }) => {
// try {
// const message = await Message.findById(data.messageId);
// if (message && message.receiver.toString() === userId && !message.deliveredAt) {
// message.deliveredAt = new Date();
// await message.save();
// helpers.getIO().to(`user:${message.sender}`).emit("message:delivered", {
// messageId: message._id,
// deliveredAt: message.deliveredAt,
// });
// }
// } catch (error) {
// console.error("Error marking message as delivered:", error);
// }
// });

// // Mark specific message as read
// socket.on("message:read", async (data: { messageId: string }) => {
// try {
// const message = await Message.findById(data.messageId);
// if (message && message.receiver.toString() === userId && !message.readAt) {
// message.readAt = new Date();
// message.seen = true;
// await message.save();
// helpers.getIO().to(`user:${message.sender}`).emit("message:read", {
// messageId: message._id,
// readAt: message.readAt,
// });
// emitUnreadCount(userId, message.chatId.toString());
// }
// } catch (error) {
// console.error("Error marking message as read:", error);
// }
// });

// // Clean up active chats on disconnect
// socket.on("disconnect", () => {
// activeChats.delete(userId);
// });
// };

// export default registerMessageEvents;