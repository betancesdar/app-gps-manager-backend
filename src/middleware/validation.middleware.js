/**
 * Input Validation Schemas
 * Using Joi for robust request body validation
 */

const Joi = require('joi');

// ─────────────────────────────────────────────────────────────────
// Auth Schemas
// ─────────────────────────────────────────────────────────────────
const loginSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30)
    .required()
    .messages({
      'string.alphanum': 'Username must contain only alphanumeric characters',
      'string.min': 'Username must be at least 3 characters',
      'any.required': 'Username is required',
    }),
  password: Joi.string()
    .min(6)
    .max(100)
    .required()
    .messages({
      'string.min': 'Password must be at least 6 characters',
      'any.required': 'Password is required',
    }),
});

// ─────────────────────────────────────────────────────────────────
// Device Schemas
// ─────────────────────────────────────────────────────────────────
const deviceRegisterSchema = Joi.object({
  deviceId: Joi.string()
    .required()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .messages({
      'string.pattern.base': 'Device ID must contain only alphanumeric characters, hyphens, or underscores',
      'any.required': 'Device ID is required',
    }),
  platform: Joi.string()
    .valid('android', 'ios')
    .default('android'),
  appVersion: Joi.string()
    .pattern(/^\d+\.\d+\.\d+$/)
    .required()
    .messages({
      'string.pattern.base': 'App version must be in format X.Y.Z',
    }),
  label: Joi.string()
    .max(100)
    .optional(),
});

const deviceUpdateSchema = Joi.object({
  label: Joi.string()
    .max(100)
    .optional(),
  isConnected: Joi.boolean()
    .optional(),
});

// ─────────────────────────────────────────────────────────────────
// Route Schemas
// ─────────────────────────────────────────────────────────────────
const routePointSchema = Joi.object({
  lat: Joi.number()
    .min(-90)
    .max(90)
    .required()
    .messages({
      'number.min': 'Latitude must be >= -90',
      'number.max': 'Latitude must be <= 90',
      'any.required': 'Latitude is required',
    }),
  lng: Joi.number()
    .min(-180)
    .max(180)
    .required()
    .messages({
      'number.min': 'Longitude must be >= -180',
      'number.max': 'Longitude must be <= 180',
      'any.required': 'Longitude is required',
    }),
  speed: Joi.number()
    .min(0)
    .max(300)
    .optional(),
  bearing: Joi.number()
    .min(0)
    .max(360)
    .optional(),
  accuracy: Joi.number()
    .min(0)
    .optional(),
});

const routeFromPointsSchema = Joi.object({
  name: Joi.string()
    .max(200)
    .required(),
  points: Joi.array()
    .items(routePointSchema)
    .min(2)
    .required()
    .messages({
      'array.min': 'Route must have at least 2 points',
      'any.required': 'Points array is required',
    }),
});

const routeFromGPXSchema = Joi.object({
  name: Joi.string()
    .max(200)
    .required(),
  gpxContent: Joi.string()
    .required()
    .messages({
      'any.required': 'GPX content is required',
    }),
});

const routeConfigSchema = Joi.object({
  speed: Joi.number()
    .min(1)
    .max(300)
    .optional(),
  accuracy: Joi.number()
    .min(0)
    .optional(),
  loop: Joi.boolean()
    .optional(),
  intervalMs: Joi.number()
    .min(100)
    .max(60000)
    .messages({
      'number.min': 'Interval must be at least 100ms',
      'number.max': 'Interval cannot exceed 60 seconds',
    })
    .optional(),
});

// ─────────────────────────────────────────────────────────────────
// Stream Schemas
// ─────────────────────────────────────────────────────────────────
const streamStartSchema = Joi.object({
  deviceId: Joi.string()
    .required(),
  routeId: Joi.string()
    .uuid()
    .required(),
  speed: Joi.number()
    .min(1)
    .max(300)
    .optional(),
  loop: Joi.boolean()
    .optional(),
});

const streamControlSchema = Joi.object({
  deviceId: Joi.string()
    .required(),
});

// ─────────────────────────────────────────────────────────────────
// Geocoding Schemas
// ─────────────────────────────────────────────────────────────────
const geocodeSchema = Joi.object({
  query: Joi.string()
    .min(3)
    .max(200)
    .required(),
});

const reverseGeocodeSchema = Joi.object({
  lat: Joi.number()
    .min(-90)
    .max(90)
    .required(),
  lng: Joi.number()
    .min(-180)
    .max(180)
    .required(),
});

// ─────────────────────────────────────────────────────────────────
// Validation Middleware
// ─────────────────────────────────────────────────────────────────
function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      const messages = error.details.map((detail) => ({
        path: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: messages,
      });
    }

    req.validatedBody = value;
    next();
  };
}

// ─────────────────────────────────────────────────────────────────
// Query Parameter Validation
// ─────────────────────────────────────────────────────────────────
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      const messages = error.details.map((detail) => ({
        path: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: messages,
      });
    }

    req.validatedQuery = value;
    next();
  };
}

module.exports = {
  // Schemas
  loginSchema,
  deviceRegisterSchema,
  deviceUpdateSchema,
  routeFromPointsSchema,
  routeFromGPXSchema,
  routeConfigSchema,
  streamStartSchema,
  streamControlSchema,
  geocodeSchema,
  reverseGeocodeSchema,

  // Middleware
  validateRequest,
  validateQuery,
};
