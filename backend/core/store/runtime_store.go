package store

import "context"

// Chat-related types used by RuntimeStore. Defined here to avoid circular dependency
// between store and chat packages.

type ChatStatus struct {
	Status        string `json:"status"`
	CurrentResult string `json:"current_result"`
	LastUpdate    int64  `json:"last_update"`
	TotalChunks   int32  `json:"total_chunks"`
}

type ChatInput struct {
	RawContent string `json:"raw_content"`
	Seq        int    `json:"seq"`
	CreatedAt  int64  `json:"created_at"`
}

type MultiAnswerInfo struct {
	PrimaryHistoryID   string `json:"primary_history_id"`
	SecondaryHistoryID string `json:"secondary_history_id"`
	Seq                int    `json:"seq"`
	CreatedAt          int64  `json:"created_at"`
}

type ChatChunkResponse struct {
	ConversationID    string   `json:"conversation_id"`
	Seq               int32    `json:"seq"`
	Message           string   `json:"message"`
	Delta             string   `json:"delta"`
	FinishReason      string   `json:"finish_reason"`
	HistoryID         string   `json:"history_id"`
	Sources           []any    `json:"sources,omitempty"`
	PromptQuestions   []string `json:"prompt_questions,omitempty"`
	ReasoningContent  string   `json:"reasoning_content,omitempty"`
	ThinkingDurationS int64    `json:"thinking_duration_s,omitempty"`
}

// RuntimeStore abstracts the volatile state backend (Redis in Cloud mode, in-memory in Desktop mode).
type RuntimeStore interface {
	SetChatStatus(ctx context.Context, conversationID, historyID, status, currentResult string) error
	GetChatStatus(ctx context.Context, conversationID, historyID string) (*ChatStatus, error)
	GetGeneratingHistoryIDs(ctx context.Context, conversationID string) ([]string, error)
	ClearChatData(ctx context.Context, conversationID, historyID string) error

	AppendChatChunk(ctx context.Context, conversationID, historyID string, chunk *ChatChunkResponse) error
	GetChatChunks(ctx context.Context, conversationID, historyID string) ([]*ChatChunkResponse, error)
	GetChatChunksFrom(ctx context.Context, conversationID, historyID string, from int64) ([]*ChatChunkResponse, error)
	WatchChatChunks(ctx context.Context, conversationID, historyID string, lastIndex int64, callback func(*ChatChunkResponse) error) error

	SetChatCancelSignal(ctx context.Context, conversationID, historyID string) error
	WatchChatCancelSignal(ctx context.Context, conversationID, historyID string) error

	SetMultiAnswerInfo(ctx context.Context, conversationID, primaryHistoryID, secondaryHistoryID string, seq int) error
	GetMultiAnswerInfo(ctx context.Context, conversationID, primaryHistoryID string) (*MultiAnswerInfo, error)

	SetChatInput(ctx context.Context, conversationID, historyID, rawContent string, seq int) error
	GetChatInput(ctx context.Context, conversationID, historyID string) (*ChatInput, error)

	Close() error
}
