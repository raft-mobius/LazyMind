// Package store text core text DB、Redis InitializetextRequestUsertext，text chat、doc、file text。
package store

import (
	"os"
	"strings"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"lazymind/core/common"
)

var (
	db           *gorm.DB
	lazyllmDB    *gorm.DB
	rdb          *redis.Client
	runtimeStore RuntimeStore
)

// Init Initializetext DB text Redis，text main textStarttext
func Init(database, lazyllmDatabase *gorm.DB, redisClient *redis.Client) {
	db = database
	if lazyllmDatabase != nil {
		lazyllmDB = lazyllmDatabase
	} else {
		lazyllmDB = database
	}
	rdb = redisClient
	runtimeStore = NewRuntimeStore(redisClient)
}

// DB text *gorm.DB
func DB() *gorm.DB { return db }

// LazyLLMDB text lazyllm text；text。
func LazyLLMDB() *gorm.DB {
	if lazyllmDB != nil {
		return lazyllmDB
	}
	return db
}

// Redis text *redis.Client，text nil（text）
func Redis() *redis.Client { return rdb }

// Runtime returns the RuntimeStore instance (memory or Redis based on config).
func Runtime() RuntimeStore { return runtimeStore }

// MustRedisFromEnv textCreate Redis text Ping，Failedtext panic，text main Initializetext
// Returns nil when LAZYMIND_STATE_BACKEND=memory (no Redis needed).
func MustRedisFromEnv() *redis.Client {
	if strings.TrimSpace(os.Getenv("LAZYMIND_STATE_BACKEND")) == "memory" {
		return nil
	}
	return common.MustRedisFromEnv()
}
