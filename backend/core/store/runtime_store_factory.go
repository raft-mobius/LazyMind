package store

import (
	"os"
	"strings"

	"github.com/redis/go-redis/v9"
	"lazymind/core/log"
)

// NewRuntimeStore creates the appropriate RuntimeStore based on LAZYMIND_STATE_BACKEND env var.
// "hybrid" → SQLite+memory (Desktop Phase 2), "memory" → in-memory (Desktop mode), "redis" or "" → Redis (Cloud mode).
func NewRuntimeStore(redisClient *redis.Client) RuntimeStore {
	backend := strings.TrimSpace(os.Getenv("LAZYMIND_STATE_BACKEND"))
	switch backend {
	case "hybrid":
		dbDSN := os.Getenv("ACL_DB_DSN")
		if dbDSN == "" {
			log.Logger.Warn().Msg("RuntimeStore: ACL_DB_DSN not set for hybrid mode, falling back to memory")
			return NewMemoryRuntimeStore()
		}
		store, err := NewHybridRuntimeStore(dbDSN)
		if err != nil {
			log.Logger.Warn().Err(err).Msg("RuntimeStore: HybridRuntimeStore init failed, falling back to memory")
			return NewMemoryRuntimeStore()
		}
		log.Logger.Info().Msg("RuntimeStore: using hybrid SQLite+memory backend (Desktop Phase 2)")
		return store
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
