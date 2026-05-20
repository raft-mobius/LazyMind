package store

import (
	"os"
	"strings"

	"github.com/redis/go-redis/v9"
	"lazymind/core/log"
)

// NewRuntimeStore creates the appropriate RuntimeStore based on LAZYMIND_STATE_BACKEND env var.
// "memory" → in-memory (Desktop mode), "redis" or "" → Redis (Cloud mode).
func NewRuntimeStore(redisClient *redis.Client) RuntimeStore {
	backend := strings.TrimSpace(os.Getenv("LAZYMIND_STATE_BACKEND"))
	switch backend {
	case "memory":
		log.Logger.Info().Msg("RuntimeStore: using in-memory backend (Desktop mode)")
		return NewMemoryRuntimeStore()
	default:
		if redisClient == nil {
			log.Logger.Warn().Msg("RuntimeStore: Redis client is nil, falling back to in-memory backend")
			return NewMemoryRuntimeStore()
		}
		log.Logger.Info().Msg("RuntimeStore: using Redis backend (Cloud mode)")
		return NewRedisRuntimeStore(redisClient)
	}
}
