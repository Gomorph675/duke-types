package com.example.model;

import java.util.UUID;
import java.time.LocalDateTime;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ConcurrentSkipListMap;
import com.google.common.collect.ImmutableList;
import com.google.common.collect.ImmutableMap;
import com.google.common.collect.Multimap;
import org.apache.commons.lang3.tuple.Pair;
import org.apache.commons.lang3.tuple.Triple;
import com.example.model.Status;
import javax.annotation.Nullable;

/**
 * Tracks audit events and runtime counters for a resource.
 */
@Entity
@Data
public class AuditLog {

    @Id
    private UUID id;

    private AtomicInteger eventCount;

    private AtomicLong lastEventMillis;

    private AtomicBoolean locked;

    private AtomicReference<Status> currentStatus;

    private ImmutableList<String> changedFields;

    private ImmutableMap<String, String> beforeSnapshot;

    private ImmutableMap<String, String> afterSnapshot;

    private Multimap<String, String> tagsByCategory;

    private CopyOnWriteArrayList<String> observers;

    private ConcurrentSkipListMap<String, Integer> scoreboard;

    private Pair<String, LocalDateTime> latestChange;

    @Nullable
    private Triple<String, String, Integer> topContributor;
}
