import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from "./config";
import { User } from "../models/user.model";
import crypto from "crypto";
import bcrypt from "bcrypt";

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_REDIRECT_URI,
    },
    async (accessToken, refreshToken, profile: Profile, done) => {
      try {
        // Check if user already exists
        let user = await User.findOne({ googleId: profile.id });

        // If user doesn't exist, create a new one
        if (!user) {
          const randomPassword = crypto.randomBytes(16).toString("hex"); // Random 32-char password
          const hashedPassword = await bcrypt.hash(randomPassword, 10); // Hash before saving

          user = await User.create({
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value,
            avatar: profile.photos?.[0]?.value,
            password: hashedPassword, // Save hashed password
          });
        }

        return done(null, user);
      } catch (err) {
        return done(err as Error, undefined);
      }
    }
  )
);

export default passport;
