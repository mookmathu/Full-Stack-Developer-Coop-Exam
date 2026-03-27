import jwt from "jsonwebtoken";
import { errorResponse } from "../utils/error.js";

export const JWT_SECRET = process.env.JWT_SECRET || "SECRET_KEY_FLEET";
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "REFRESH_SECRET_KEY_FLEET";

export const authMiddleware = (roles = []) => {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json(
        errorResponse("NO_TOKEN", "Unauthorized: No token provided")
      );
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      // Role-based access check
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json(
          errorResponse("FORBIDDEN", "No permission for this resource")
        );
      }

      req.user = decoded;
      next();
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json(
          errorResponse("TOKEN_EXPIRED", "Access token expired, please refresh")
        );
      }
      return res.status(401).json(
        errorResponse("INVALID_TOKEN", "Invalid token")
      );
    }
  };
};