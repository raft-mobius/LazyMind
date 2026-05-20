package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	redisChatStreamKeyPrefix = "rag/chat/stream:%s:%s"
	redisChatStatusKeyPrefix = "rag/chat/status:%s"
	redisChatStopKeyPrefix   = "rag/chat/stop:%s:%s"
	redisChatMultiKeyPrefix  = "rag/chat/multi:%s:%s"
	redisChatInputKeyPrefix  = "rag/chat/input:%s:%s"

	redisChatCacheExpireTime = time.Hour * 2
	redisChatStopExpireTime  = 15 * time.Minute
)

type RedisRuntimeStore struct {
	client *redis.Client
}

func NewRedisRuntimeStore(client *redis.Client) *RedisRuntimeStore {
	return &RedisRuntimeStore{client: client}
}

func (s *RedisRuntimeStore) SetChatStatus(ctx context.Context, conversationID, historyID, status, currentResult string) error {
	key := fmt.Sprintf(redisChatStatusKeyPrefix, conversationID)
	totalChunks := int32(0)
	chunks, _ := s.GetChatChunks(ctx, conversationID, historyID)
	if len(chunks) > 0 {
		totalChunks = int32(len(chunks))
	}
	data := ChatStatus{Status: status, CurrentResult: currentResult, LastUpdate: time.Now().Unix(), TotalChunks: totalChunks}
	bs, _ := json.Marshal(data)
	if err := s.client.HSet(ctx, key, historyID, bs).Err(); err != nil {
		return err
	}
	return s.client.Expire(ctx, key, redisChatCacheExpireTime).Err()
}

func (s *RedisRuntimeStore) GetChatStatus(ctx context.Context, conversationID, historyID string) (*ChatStatus, error) {
	key := fmt.Sprintf(redisChatStatusKeyPrefix, conversationID)
	bs, err := s.client.HGet(ctx, key, historyID).Bytes()
	if err != nil {
		return nil, err
	}
	var st ChatStatus
	if err := json.Unmarshal(bs, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

func (s *RedisRuntimeStore) GetGeneratingHistoryIDs(ctx context.Context, conversationID string) ([]string, error) {
	key := fmt.Sprintf(redisChatStatusKeyPrefix, conversationID)
	m, err := s.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	var ids []string
	for hid, bs := range m {
		var st ChatStatus
		if json.Unmarshal([]byte(bs), &st) != nil {
			continue
		}
		if st.Status == "generating" {
			ids = append(ids, hid)
		}
	}
	return ids, nil
}

func (s *RedisRuntimeStore) ClearChatData(ctx context.Context, conversationID, historyID string) error {
	key := fmt.Sprintf(redisChatStatusKeyPrefix, conversationID)
	_ = s.client.HDel(ctx, key, historyID).Err()
	_ = s.client.Del(ctx, fmt.Sprintf(redisChatStreamKeyPrefix, conversationID, historyID)).Err()
	_ = s.client.Del(ctx, fmt.Sprintf(redisChatInputKeyPrefix, conversationID, historyID)).Err()
	return nil
}

func (s *RedisRuntimeStore) AppendChatChunk(ctx context.Context, conversationID, historyID string, chunk *ChatChunkResponse) error {
	bs, err := json.Marshal(chunk)
	if err != nil {
		return err
	}
	key := fmt.Sprintf(redisChatStreamKeyPrefix, conversationID, historyID)
	if err := s.client.RPush(ctx, key, bs).Err(); err != nil {
		return err
	}
	return s.client.Expire(ctx, key, redisChatCacheExpireTime).Err()
}

func (s *RedisRuntimeStore) GetChatChunks(ctx context.Context, conversationID, historyID string) ([]*ChatChunkResponse, error) {
	return s.GetChatChunksFrom(ctx, conversationID, historyID, 0)
}

func (s *RedisRuntimeStore) GetChatChunksFrom(ctx context.Context, conversationID, historyID string, from int64) ([]*ChatChunkResponse, error) {
	key := fmt.Sprintf(redisChatStreamKeyPrefix, conversationID, historyID)
	list, err := s.client.LRange(ctx, key, from, -1).Result()
	if err != nil {
		return nil, err
	}
	out := make([]*ChatChunkResponse, 0, len(list))
	for _, s := range list {
		var c ChatChunkResponse
		if json.Unmarshal([]byte(s), &c) != nil {
			continue
		}
		out = append(out, &c)
	}
	return out, nil
}

func (s *RedisRuntimeStore) WatchChatChunks(ctx context.Context, conversationID, historyID string, lastIndex int64, callback func(*ChatChunkResponse) error) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
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

func (s *RedisRuntimeStore) SetChatCancelSignal(ctx context.Context, conversationID, historyID string) error {
	key := fmt.Sprintf(redisChatStopKeyPrefix, conversationID, historyID)
	if err := s.client.LPush(ctx, key, "1").Err(); err != nil {
		return err
	}
	return s.client.Expire(ctx, key, redisChatStopExpireTime).Err()
}

func (s *RedisRuntimeStore) WatchChatCancelSignal(ctx context.Context, conversationID, historyID string) error {
	key := fmt.Sprintf(redisChatStopKeyPrefix, conversationID, historyID)
	_, err := s.client.BLPop(ctx, 0, key).Result()
	return err
}

func (s *RedisRuntimeStore) SetMultiAnswerInfo(ctx context.Context, conversationID, primaryHistoryID, secondaryHistoryID string, seq int) error {
	key := fmt.Sprintf(redisChatMultiKeyPrefix, conversationID, primaryHistoryID)
	data := MultiAnswerInfo{
		PrimaryHistoryID:   primaryHistoryID,
		SecondaryHistoryID: secondaryHistoryID,
		Seq:                seq,
		CreatedAt:          time.Now().Unix(),
	}
	bs, _ := json.Marshal(data)
	return s.client.Set(ctx, key, bs, redisChatCacheExpireTime).Err()
}

func (s *RedisRuntimeStore) GetMultiAnswerInfo(ctx context.Context, conversationID, primaryHistoryID string) (*MultiAnswerInfo, error) {
	key := fmt.Sprintf(redisChatMultiKeyPrefix, conversationID, primaryHistoryID)
	bs, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}
	var info MultiAnswerInfo
	if err := json.Unmarshal(bs, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func (s *RedisRuntimeStore) SetChatInput(ctx context.Context, conversationID, historyID, rawContent string, seq int) error {
	key := fmt.Sprintf(redisChatInputKeyPrefix, conversationID, historyID)
	data := ChatInput{RawContent: rawContent, Seq: seq, CreatedAt: time.Now().UnixMilli()}
	bs, _ := json.Marshal(data)
	return s.client.Set(ctx, key, bs, redisChatCacheExpireTime).Err()
}

func (s *RedisRuntimeStore) GetChatInput(ctx context.Context, conversationID, historyID string) (*ChatInput, error) {
	key := fmt.Sprintf(redisChatInputKeyPrefix, conversationID, historyID)
	bs, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}
	var in ChatInput
	if err := json.Unmarshal(bs, &in); err != nil {
		return nil, err
	}
	return &in, nil
}

func (s *RedisRuntimeStore) Close() error {
	return nil
}
