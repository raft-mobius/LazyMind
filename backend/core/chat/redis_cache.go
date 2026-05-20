package chat

import (
	"context"

	"github.com/redis/go-redis/v9"

	"lazymind/core/store"
)

// Type aliases so existing code in this package compiles without changes.
type ChatStatus = store.ChatStatus
type ChatInput = store.ChatInput
type MultiAnswerInfo = store.MultiAnswerInfo
type ChatChunkResponse = store.ChatChunkResponse

// All functions below delegate to store.Runtime(), keeping the rdb parameter
// for backward compatibility (it is ignored — the RuntimeStore was initialized at startup).

func setChatStatus(ctx context.Context, _ *redis.Client, conversationID, historyID, status, currentResult string) error {
	return store.Runtime().SetChatStatus(ctx, conversationID, historyID, status, currentResult)
}

func getGeneratingHistoryIDs(ctx context.Context, _ *redis.Client, conversationID string) ([]string, error) {
	return store.Runtime().GetGeneratingHistoryIDs(ctx, conversationID)
}

func getChatStatus(ctx context.Context, _ *redis.Client, conversationID, historyID string) (*ChatStatus, error) {
	return store.Runtime().GetChatStatus(ctx, conversationID, historyID)
}

func clearChatData(ctx context.Context, _ *redis.Client, conversationID, historyID string) error {
	return store.Runtime().ClearChatData(ctx, conversationID, historyID)
}

func setChatInput(ctx context.Context, _ *redis.Client, conversationID, historyID, rawContent string, seq int) error {
	return store.Runtime().SetChatInput(ctx, conversationID, historyID, rawContent, seq)
}

func getChatInput(ctx context.Context, _ *redis.Client, conversationID, historyID string) (*ChatInput, error) {
	return store.Runtime().GetChatInput(ctx, conversationID, historyID)
}

func appendChatChunk(ctx context.Context, _ *redis.Client, conversationID, historyID string, chunk *ChatChunkResponse) error {
	return store.Runtime().AppendChatChunk(ctx, conversationID, historyID, chunk)
}

func getChatChunks(ctx context.Context, _ *redis.Client, conversationID, historyID string) ([]*ChatChunkResponse, error) {
	return store.Runtime().GetChatChunks(ctx, conversationID, historyID)
}

func getChatChunksFrom(ctx context.Context, _ *redis.Client, conversationID, historyID string, from int64) ([]*ChatChunkResponse, error) {
	return store.Runtime().GetChatChunksFrom(ctx, conversationID, historyID, from)
}

func setChatCancelSignal(ctx context.Context, _ *redis.Client, conversationID, historyID string) error {
	return store.Runtime().SetChatCancelSignal(ctx, conversationID, historyID)
}

func watchChatCancelSignal(ctx context.Context, _ *redis.Client, conversationID, historyID string) error {
	return store.Runtime().WatchChatCancelSignal(ctx, conversationID, historyID)
}

func watchChatChunks(ctx context.Context, _ *redis.Client, conversationID, historyID string, lastIndex int64, callback func(*ChatChunkResponse) error) error {
	return store.Runtime().WatchChatChunks(ctx, conversationID, historyID, lastIndex, callback)
}

func setMultiAnswerInfo(ctx context.Context, _ *redis.Client, conversationID, primaryHistoryID, secondaryHistoryID string, seq int) error {
	return store.Runtime().SetMultiAnswerInfo(ctx, conversationID, primaryHistoryID, secondaryHistoryID, seq)
}

func getMultiAnswerInfo(ctx context.Context, _ *redis.Client, conversationID, primaryHistoryID string) (*MultiAnswerInfo, error) {
	return store.Runtime().GetMultiAnswerInfo(ctx, conversationID, primaryHistoryID)
}
