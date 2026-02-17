import { User } from "../models/user.model";

export const saveStripeAccountIdToUser = async (
    userId: string,
    stripeAccountId: string
) => {
    try {
        const user = await User.findById(userId);
        if (!user) throw new Error("User not found");

        user.stripe.connectedAccountId = stripeAccountId;
        await user.save();

        return user;
    } catch (err) {
        console.error("Error saving Stripe account ID:", err);
        throw err;
    }
};
