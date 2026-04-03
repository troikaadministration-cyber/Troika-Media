import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../../components/brand/Header';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { useCurriculum } from '../../../hooks/useCurriculum';
import type { ResourceType } from '@troika/shared';

const TYPE_FILTERS: { label: string; value: ResourceType | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pieces', value: 'piece' },
  { label: 'Exercises', value: 'exercise' },
  { label: 'Activities', value: 'activity' },
];

export default function CurriculumScreen() {
  const {
    resources, tags, loading, searchQuery, setSearchQuery,
    typeFilter, setTypeFilter, selectedTags, toggleTag, deleteResource,
  } = useCurriculum();

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'piece': return 'musical-notes';
      case 'exercise': return 'pencil';
      case 'activity': return 'game-controller';
      default: return 'document';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title="Curriculum Library" unreadCount={1} />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Teaching Resources header card */}
        <Card borderColor="#F0C93B">
          <Text style={styles.resourcesTitle}>Teaching Resources</Text>
          <Text style={styles.resourcesDesc}>
            Organize your curriculum by musical concepts and student needs
          </Text>

          {/* Search bar + add button */}
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color="#9CA3AF" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search resources or tags..."
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
            <TouchableOpacity style={styles.addButton}>
              <Ionicons name="add" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Type filter chips */}
          <View style={styles.filterRow}>
            {TYPE_FILTERS.map((filter) => (
              <TouchableOpacity
                key={filter.value}
                style={[
                  styles.filterChip,
                  typeFilter === filter.value && styles.filterChipActive,
                  filter.value === 'activity' && typeFilter !== filter.value && styles.filterChipActivity,
                ]}
                onPress={() => setTypeFilter(filter.value)}
              >
                <Text style={[
                  styles.filterChipText,
                  typeFilter === filter.value && styles.filterChipTextActive,
                  filter.value === 'activity' && typeFilter !== filter.value && styles.filterChipTextActivity,
                ]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tag cloud */}
          <Text style={styles.conceptsLabel}>Filter by concepts:</Text>
          <View style={styles.tagCloud}>
            {tags.map((tag) => (
              <TouchableOpacity
                key={tag.id}
                style={[
                  styles.tagChip,
                  selectedTags.includes(tag.name) && styles.tagChipSelected,
                ]}
                onPress={() => toggleTag(tag.name)}
              >
                <Text style={[
                  styles.tagChipText,
                  selectedTags.includes(tag.name) && styles.tagChipTextSelected,
                ]}>
                  {tag.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {/* Results count */}
        <Text style={styles.resultCount}>{resources.length} resources found</Text>

        {/* Resource cards */}
        {resources.map((resource) => (
          <Card key={resource.id} borderColor="#2A9D8F" style={{ marginBottom: 12 }}>
            {/* Type + Level badges + icon */}
            <View style={styles.resourceHeader}>
              <View style={styles.resourceBadges}>
                <View style={styles.resourceIcon}>
                  <Ionicons name={getTypeIcon(resource.type) as any} size={16} color="#2A9D8F" />
                </View>
                <Badge
                  label={resource.type.charAt(0).toUpperCase() + resource.type.slice(1)}
                  variant={resource.type as any}
                />
                <Badge
                  label={resource.level.charAt(0).toUpperCase() + resource.level.slice(1)}
                  variant={resource.level as any}
                />
              </View>
              <TouchableOpacity onPress={() => deleteResource(resource.id)}>
                <Ionicons name="trash-outline" size={18} color="#E8604C" />
              </TouchableOpacity>
            </View>

            <Text style={styles.resourceTitle}>{resource.title}</Text>
            {resource.description && (
              <Text style={styles.resourceDescription}>{resource.description}</Text>
            )}

            {/* Tags */}
            {resource.tags && resource.tags.length > 0 && (
              <View style={styles.resourceTags}>
                {resource.tags.map((tag) => (
                  <View key={tag.id} style={styles.resourceTag}>
                    <Text style={styles.resourceTagText}>{tag.name}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Teaching tip */}
            {resource.teaching_tip && (
              <View style={styles.teachingTip}>
                <Ionicons name="bulb-outline" size={16} color="#F0C93B" style={{ marginRight: 8, marginTop: 2 }} />
                <Text style={styles.teachingTipText}>{resource.teaching_tip}</Text>
              </View>
            )}

            {/* Footer: date + label */}
            <View style={styles.resourceFooter}>
              <View style={styles.footerItem}>
                <Ionicons name="calendar-outline" size={14} color="#9CA3AF" />
                <Text style={styles.footerText}>Added {new Date(resource.created_at).toLocaleDateString('en-GB')}</Text>
              </View>
              <View style={styles.footerItem}>
                <Ionicons name="bookmark-outline" size={14} color="#2A9D8F" />
                <Text style={[styles.footerText, { color: '#2A9D8F' }]}>Teaching Resource</Text>
              </View>
            </View>
          </Card>
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scroll: {
    flex: 1,
  },
  resourcesTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  resourcesDesc: {
    fontSize: 14,
    color: '#2A9D8F',
    marginBottom: 16,
    lineHeight: 20,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1A1A2E',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#F0C93B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterChipActive: {
    backgroundColor: '#1A1A2E',
    borderColor: '#1A1A2E',
  },
  filterChipActivity: {
    borderColor: '#E8604C',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterChipTextActivity: {
    color: '#E8604C',
  },
  conceptsLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 10,
  },
  tagCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tagChipSelected: {
    backgroundColor: '#2A9D8F',
    borderColor: '#2A9D8F',
  },
  tagChipText: {
    fontSize: 12,
    color: '#6B7280',
  },
  tagChipTextSelected: {
    color: '#FFFFFF',
  },
  resultCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2A9D8F',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  resourceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  resourceBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resourceIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resourceTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  resourceDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 10,
  },
  resourceTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  resourceTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  resourceTagText: {
    fontSize: 11,
    color: '#6B7280',
  },
  teachingTip: {
    flexDirection: 'row',
    backgroundColor: '#FDF6E3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  teachingTipText: {
    fontSize: 13,
    color: '#1A1A2E',
    flex: 1,
    lineHeight: 18,
  },
  resourceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});
