package com.example.model;

import java.net.URI;
import java.net.URL;
import java.nio.file.Path;
import java.io.File;
import java.util.regex.Pattern;
import java.util.UUID;
import java.time.LocalDateTime;
import javax.annotation.Nullable;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;

/**
 * A file or media asset attached to a resource.
 */
@Entity
@Data
public class MediaAttachment {

    @Id
    private UUID id;

    private String filename;

    private long sizeBytes;

    private URI storageUri;

    private URL downloadUrl;

    @Nullable
    private Path localCachePath;

    @Nullable
    private File tempFile;

    private Pattern mimePattern;

    private byte[] checksum;

    @Nullable
    private JsonNode metadata;

    @Nullable
    private ObjectNode properties;

    @Nullable
    private ArrayNode tags;

    private LocalDateTime uploadedAt;
}
