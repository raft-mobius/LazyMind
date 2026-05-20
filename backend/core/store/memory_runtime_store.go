package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

const (
	memoryCacheExpireTime = 2 * time.Hour
	memoryStopExpireTime  = 15 * time.Minute
	memoryCleanupInterval = 30 * time.Second
)

type memoryEntry struct {
	value     []byte
	expiresAt time.Time
}

type MemoryRuntimeStore struct {
	mu       sync.RWMutex
	kv       map[string]*memoryEntry    // simple key-value
	hashes   map[string]map[string]*memoryEntry // hash-like structures
	lists    map[string][]*memoryEntry   // list-like structures
	signals  map[string]chan struct{}    // stop signals
	stopOnce sync.Once
	done     chan struct{}
}

func NewMemoryRuntimeStore() *MemoryRuntimeStore {
	s := &MemoryRuntimeStore{
		kv:      make(map[string]*memoryEntry),
		hashes:  make(map[string]map[string]*memoryEntry),
		lists:   make(map[string][]*memoryEntry),
		signals: make(map[string]chan struct{}),
		done:    make(chan struct{}),
	}
	go s.cleanupLoop()
	return s
}

func (s *MemoryRuntimeStore) SetChatStatus(ctx context.Context, conversationID, historyID, status, currentResult string) error {
	key := fmt.Sprintf("rag/chat/status:%s", conversationID)

	chunks, _ := s.GetChatChunks(ctx, conversationID, historyID)
	totalChunks := int32(len(chunks))

	data := ChatStatus{Status: status, CurrentResult: currentResult, LastUpdate: time.Now().Unix(), TotalChunks: totalChunks}
	bs, _ := json.Marshal(data)

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.hashes[key] == nil {
		s.hashes[key] = make(map[string]*memoryEntry)
	}
	s.hashes[key][historyID] = &memoryEntry{
		value:     bs,
		expiresAt: time.Now().Add(memoryCacheExpireTime),
	}
	return nil
}

func (s *MemoryRuntimeStore) GetChatStatus(_ context.Context, conversationID, historyID string) (*ChatStatus, error) {
	key := fmt.Sprintf("rag/chat/status:%s", conversationID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	h := s.hashes[key]
	if h == nil {
		return nil, fmt.Errorf("not found")
	}
	entry := h[historyID]
	if entry == nil || time.Now().After(entry.expiresAt) {
		return nil, fmt.Errorf("not found")
	}

	var st ChatStatus
	if err := json.Unmarshal(entry.value, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

func (s *MemoryRuntimeStore) GetGeneratingHistoryIDs(_ context.Context, conversationID string) ([]string, error) {
	key := fmt.Sprintf("rag/chat/status:%s", conversationID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	h := s.hashes[key]
	if h == nil {
		return nil, nil
	}

	var ids []string
	now := time.Now()
	for hid, entry := range h {
		if now.After(entry.expiresAt) {
			continue
		}
		var st ChatStatus
		if json.Unmarshal(entry.value, &st) != nil {
			continue
		}
		if st.Status == "generating" {
			ids = append(ids, hid)
		}
	}
	return ids, nil
}

func (s *MemoryRuntimeStore) ClearChatData(_ context.Context, conversationID, historyID string) error {
	statusKey := fmt.Sprintf("rag/chat/status:%s", conversationID)
	streamKey := fmt.Sprintf("rag/chat/stream:%s:%s", conversationID, historyID)
	inputKey := fmt.Sprintf("rag/chat/input:%s:%s", conversationID, historyID)

	s.mu.Lock()
	defer s.mu.Unlock()

	if h := s.hashes[statusKey]; h != nil {
		delete(h, historyID)
	}
	delete(s.lists, streamKey)
	delete(s.kv, inputKey)
	return nil
}

func (s *MemoryRuntimeStore) AppendChatChunk(_ context.Context, conversationID, historyID string, chunk *ChatChunkResponse) error {
	key := fmt.Sprintf("rag/chat/stream:%s:%s", conversationID, historyID)
	bs, err := json.Marshal(chunk)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.lists[key] = append(s.lists[key], &memoryEntry{
		value:     bs,
		expiresAt: time.Now().Add(memoryCacheExpireTime),
	})
	return nil
}

func (s *MemoryRuntimeStore) GetChatChunks(ctx context.Context, conversationID, historyID string) ([]*ChatChunkResponse, error) {
	return s.GetChatChunksFrom(ctx, conversationID, historyID, 0)
}

func (s *MemoryRuntimeStore) GetChatChunksFrom(_ context.Context, conversationID, historyID string, from int64) ([]*ChatChunkResponse, error) {
	key := fmt.Sprintf("rag/chat/stream:%s:%s", conversationID, historyID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	list := s.lists[key]
	if int64(len(list)) <= from {
		return nil, nil
	}

	out := make([]*ChatChunkResponse, 0, len(list)-int(from))
	for _, entry := range list[from:] {
		var c ChatChunkResponse
		if json.Unmarshal(entry.value, &c) != nil {
			continue
		}
		out = append(out, &c)
	}
	return out, nil
}

func (s *MemoryRuntimeStore) WatchChatChunks(ctx context.Context, conversationID, historyID string, lastIndex int64, callback func(*ChatChunkResponse) error) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.done:
			return fmt.Errorf("store closed")
		default:
			chunks, err := s.GetChatChunksFrom(ctx, conversationID, historyID, lastIndex+1)
			if err != nil {
				return err
			}
			for _, c := range chunks {
				if err := callback(c); err != nil {
					return err
				}
				lastIndex++
			}
			st, _ := s.GetChatStatus(ctx, conversationID, historyID)
			if st != nil {
				switch st.Status {
				case "completed", "stopped", "failed":
					return nil
				}
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
}

func (s *MemoryRuntimeStore) SetChatCancelSignal(_ context.Context, conversationID, historyID string) error {
	key := fmt.Sprintf("rag/chat/stop:%s:%s", conversationID, historyID)

	s.mu.Lock()
	ch, exists := s.signals[key]
	if !exists {
		ch = make(chan struct{}, 1)
		s.signals[key] = ch
	}
	s.mu.Unlock()

	select {
	case ch <- struct{}{}:
	default:
	}
	return nil
}

func (s *MemoryRuntimeStore) WatchChatCancelSignal(ctx context.Context, conversationID, historyID string) error {
	key := fmt.Sprintf("rag/chat/stop:%s:%s", conversationID, historyID)

	s.mu.Lock()
	ch, exists := s.signals[key]
	if !exists {
		ch = make(chan struct{}, 1)
		s.signals[key] = ch
	}
	s.mu.Unlock()

	select {
	case <-ch:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-s.done:
		return fmt.Errorf("store closed")
	}
}

func (s *MemoryRuntimeStore) SetMultiAnswerInfo(_ context.Context, conversationID, primaryHistoryID, secondaryHistoryID string, seq int) error {
	key := fmt.Sprintf("rag/chat/multi:%s:%s", conversationID, primaryHistoryID)
	data := MultiAnswerInfo{
		PrimaryHistoryID:   primaryHistoryID,
		SecondaryHistoryID: secondaryHistoryID,
		Seq:                seq,
		CreatedAt:          time.Now().Unix(),
	}
	bs, _ := json.Marshal(data)

	s.mu.Lock()
	defer s.mu.Unlock()

	s.kv[key] = &memoryEntry{
		value:     bs,
		expiresAt: time.Now().Add(memoryCacheExpireTime),
	}
	return nil
}

func (s *MemoryRuntimeStore) GetMultiAnswerInfo(_ context.Context, conversationID, primaryHistoryID string) (*MultiAnswerInfo, error) {
	key := fmt.Sprintf("rag/chat/multi:%s:%s", conversationID, primaryHistoryID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	entry := s.kv[key]
	if entry == nil || time.Now().After(entry.expiresAt) {
		return nil, fmt.Errorf("not found")
	}

	var info MultiAnswerInfo
	if err := json.Unmarshal(entry.value, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func (s *MemoryRuntimeStore) SetChatInput(_ context.Context, conversationID, historyID, rawContent string, seq int) error {
	key := fmt.Sprintf("rag/chat/input:%s:%s", conversationID, historyID)
	data := ChatInput{RawContent: rawContent, Seq: seq, CreatedAt: time.Now().UnixMilli()}
	bs, _ := json.Marshal(data)

	s.mu.Lock()
	defer s.mu.Unlock()

	s.kv[key] = &memoryEntry{
		value:     bs,
		expiresAt: time.Now().Add(memoryCacheExpireTime),
	}
	return nil
}

func (s *MemoryRuntimeStore) GetChatInput(_ context.Context, conversationID, historyID string) (*ChatInput, error) {
	key := fmt.Sprintf("rag/chat/input:%s:%s", conversationID, historyID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	entry := s.kv[key]
	if entry == nil || time.Now().After(entry.expiresAt) {
		return nil, fmt.Errorf("not found")
	}

	var in ChatInput
	if err := json.Unmarshal(entry.value, &in); err != nil {
		return nil, err
	}
	return &in, nil
}

func (s *MemoryRuntimeStore) Close() error {
	s.stopOnce.Do(func() {
		close(s.done)
	})
	return nil
}

func (s *MemoryRuntimeStore) cleanupLoop() {
	ticker := time.NewTicker(memoryCleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			s.cleanup()
		}
	}
}

func (s *MemoryRuntimeStore) cleanup() {
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	for k, entry := range s.kv {
		if now.After(entry.expiresAt) {
			delete(s.kv, k)
		}
	}

	for k, h := range s.hashes {
		for field, entry := range h {
			if now.After(entry.expiresAt) {
				delete(h, field)
			}
		}
		if len(h) == 0 {
			delete(s.hashes, k)
		}
	}

	for k, list := range s.lists {
		if len(list) > 0 && now.After(list[0].expiresAt) {
			delete(s.lists, k)
		}
	}
}
