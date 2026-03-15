package com.example.model;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.Locale;
import java.util.Currency;
import java.time.LocalDateTime;
import com.example.model.Role;
import com.example.model.Address;
import com.example.model.Status;
import javax.annotation.Nullable;
import javax.validation.constraints.NotNull;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * Represents a user in the system.
 */
@Entity
@Table(name = "users")
@Data
public class User extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @NotNull
    @Column(nullable = false)
    private String firstName;

    @NotNull
    private String lastName;

    @Nullable
    private String middleName;

    @Column(unique = true)
    private String email;

    @ManyToOne
    @Nullable
    private Address address;

    @ManyToMany
    private List<Role> roles;

    @Column
    private Status status;

    private Map<String, String> preferences;

    private Locale locale;

    private Currency currency;

    @Nullable
    private byte[] avatar;

    @Nullable
    private JsonNode metadata;

    @JsonIgnore
    private String passwordHash;

    @Transient
    private boolean online;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @Nullable
    private LocalDateTime deletedAt;
}
