import express from "express";
import passport from "passport";
import { googleCallback, verifyToken } from "../controllers/usergoogle.controller";

const router = express.Router();

// Step 1: Redirect to Google
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Step 2: Callback (after Google authentication)
router.get(
  "/callback",
  passport.authenticate("google", { session: false }),
  googleCallback
);

// Step 3: Verify JWT token
router.get("/verify", verifyToken);

export default router;
